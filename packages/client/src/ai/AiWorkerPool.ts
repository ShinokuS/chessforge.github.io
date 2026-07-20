import { getLegalMoves, type GameCommand, type LegalMove, type MatchState } from '@chessforge/engine';
import { hashPosition, type ChooseOptions, type SearchResult } from '@chessforge/ai';
import type { WorkerRequest, WorkerResponse } from './search.worker';

const INF = 1_500_000;

export type AnalysisLine = {
  scoreWhite: number;
  depth: number;
  nodes: number;
  nps: number;
  pv: SearchResult['pv'];
  best: SearchResult['best'];
  elapsedMs: number;
};

type Pending = {
  resolve: (v: WorkerResponse) => void;
  reject: (e: Error) => void;
  onProgress?: (result: SearchResult) => void;
};

function hardwareWorkers(): number {
  if (typeof navigator === 'undefined') return 2;
  const n = navigator.hardwareConcurrency || 4;
  return Math.max(2, Math.min(8, n));
}

/** Explicit `workers` is not capped by hardwareConcurrency (analysis threads). */
function resolveWorkerCount(
  requested: number | undefined,
  rootMoveCount: number,
): number {
  const want =
    requested === undefined
      ? hardwareWorkers()
      : Math.max(1, Math.floor(requested));
  return Math.max(1, Math.min(want, Math.max(1, rootMoveCount)));
}

function moveKey(m: LegalMove): string {
  return `${m.from.x},${m.from.y}->${m.to.x},${m.to.y}:${m.abilityId ?? ''}:${m.captures ? 1 : 0}:${m.push ? 1 : 0}`;
}

function rootNoise(m: LegalMove, skill: number, depth: number): number {
  const soft = Math.max(0, 10 - Math.max(0, Math.min(10, skill)));
  if (soft <= 0) return 0;
  const amp = soft * soft * 18 + soft * 40;
  const h =
    ((m.from.x * 73856093) ^
      (m.from.y * 19349663) ^
      (m.to.x * 83492791) ^
      (m.to.y * 50331653) ^
      ((m.abilityId?.length ?? 0) * 2654435761) ^
      (depth * 97)) >>>
    0;
  const unit = (h % 2001) / 1000 - 1;
  return unit * amp;
}

function moveToCommand(m: LegalMove): GameCommand {
  return {
    type: 'move',
    from: { ...m.from },
    to: { ...m.to },
    ...(m.abilityId !== undefined ? { abilityId: m.abilityId } : {}),
    ...(m.push ? { push: true } : {}),
  };
}

/**
 * Pool of search workers: UI stays responsive while all cores grind the AI move.
 */
export class AiWorkerPool {
  private workers: Worker[] = [];
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private chain: Promise<unknown> = Promise.resolve();
  private rootPv = new Map<number, string>();
  /** Dedicated analysis workers — terminated on each new position (Lichess-style preempt). */
  private analysisWorkers: Worker[] = [];
  private analysisPendingIds = new Set<number>();

  private bindWorker(w: Worker): void {
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'searchProgress') {
        p.onProgress?.(msg.result);
        return;
      }
      this.pending.delete(msg.id);
      this.analysisPendingIds.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    w.onerror = (err) => {
      console.error('AI worker error', err);
      // Reject anything still waiting on this worker so UI doesn't hang forever.
      for (const [id, pending] of [...this.pending.entries()]) {
        if (!this.analysisPendingIds.has(id)) continue;
        this.pending.delete(id);
        this.analysisPendingIds.delete(id);
        pending.reject(new Error('Analysis worker crashed'));
      }
    };
  }

  private ensureWorkers(count: number): void {
    while (this.workers.length < count) {
      const w = new Worker(new URL('./search.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.bindWorker(w);
      this.workers.push(w);
    }
  }

  private killAnalysisWorkers(): void {
    for (const id of this.analysisPendingIds) {
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        pending.reject(new DOMException('Analysis superseded', 'AbortError'));
      }
    }
    this.analysisPendingIds.clear();
    for (const w of this.analysisWorkers) w.terminate();
    this.analysisWorkers = [];
  }

  /** Abort pending analysis requests except the given ids (Lazy SMP early stop). */
  private abortAnalysisExcept(keepIds: Set<number>): void {
    for (const id of [...this.analysisPendingIds]) {
      if (keepIds.has(id)) continue;
      const pending = this.pending.get(id);
      this.analysisPendingIds.delete(id);
      if (pending) {
        this.pending.delete(id);
        pending.reject(new DOMException('Analysis superseded', 'AbortError'));
      }
    }
    // Leave workers alive until spawn/kill — rejected waiters stop waiting.
  }

  private spawnAnalysisWorkers(count: number): Worker[] {
    const n = Math.max(1, count);
    while (this.analysisWorkers.length < n) {
      const w = new Worker(new URL('./search.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.bindWorker(w);
      this.analysisWorkers.push(w);
    }
    return this.analysisWorkers.slice(0, n);
  }

  private call(
    worker: Worker,
    req: WorkerRequest,
    onProgress?: (result: SearchResult) => void,
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      const pending: Pending = { resolve, reject };
      if (onProgress) pending.onProgress = onProgress;
      this.pending.set(req.id, pending);
      worker.postMessage(req);
    });
  }

  private callAnalysis(
    worker: Worker,
    req: WorkerRequest,
    onProgress?: (result: SearchResult) => void,
  ): Promise<WorkerResponse> {
    this.analysisPendingIds.add(req.id);
    return this.call(worker, req, onProgress).finally(() => {
      this.analysisPendingIds.delete(req.id);
    });
  }

  /** Serialize searches so we don't flood workers mid-game + analysis. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private nextReqId(): number {
    return this.nextId++;
  }

  async chooseCommand(state: MatchState, options: ChooseOptions = {}): Promise<GameCommand> {
    return this.enqueue(() => this.chooseCommandParallel(state, options));
  }

  private async chooseCommandParallel(
    state: MatchState,
    options: ChooseOptions,
  ): Promise<GameCommand> {
    const rootMoves = getLegalMoves(state);
    if (rootMoves.length === 0) return { type: 'endTurn' };

    const skill = Math.max(0, Math.min(10, options.skill ?? 10));
    if (skill <= 0) {
      const idx =
        (((state.turn * 2654435761) ^ (rootMoves.length * 97)) >>> 0) % rootMoves.length;
      return moveToCommand(rootMoves[idx]!);
    }

    const maxDepth = Math.max(1, Math.min(24, options.maxDepth ?? options.depth ?? 4));
    const timeMs = options.timeMs ?? 400;
    const nodeLimit = options.nodeLimit ?? 80_000;
    const ttBits = options.ttBits ?? 16;
    const deadline = Date.now() + Math.max(30, timeMs);

    const requestedWorkers = Math.max(
      1,
      Math.floor(options.workers ?? hardwareWorkers()),
    );
    const workerCount = resolveWorkerCount(requestedWorkers, rootMoves.length);
    this.ensureWorkers(workerCount);

    // Low skill / tiny trees: one worker sync choose is enough.
    if (workerCount === 1 || maxDepth <= 2 || rootMoves.length <= 2) {
      const res = await this.call(this.workers[0]!, {
        id: this.nextReqId(),
        type: 'choose',
        state,
        options: { ...options, skill },
      });
      if (res.type !== 'choose') throw new Error('unexpected worker response');
      return res.command;
    }

    const positionKey = hashPosition(state);
    const cachedPv = this.rootPv.get(positionKey);
    let bestMove =
      rootMoves.find((move) => moveKey(move) === cachedPv) ?? rootMoves[0]!;
    let bestScore = -INF;

    for (let depth = 1; depth <= maxDepth; depth++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0 && depth > 1) break;

      // Prefer previous PV first so incomplete iterations still re-check it.
      const ordered = [
        bestMove,
        ...rootMoves.filter((m) => moveKey(m) !== moveKey(bestMove)),
      ];
      let nextMove = 0;
      const settled: WorkerResponse[] = [];
      const perNodes = Math.max(
        4_000,
        Math.floor(nodeLimit / Math.sqrt(Math.max(1, ordered.length))),
      );
      const sliceOpts: ChooseOptions = {
        timeMs: Math.max(40, remaining),
        nodeLimit: perNodes,
        ttBits,
        skill: 10,
        maxDepth: depth,
        ...(options.engine !== undefined ? { engine: options.engine } : {}),
      };

      await Promise.all(
        this.workers.slice(0, workerCount).map(async (worker) => {
          for (;;) {
            const index = nextMove++;
            const move = ordered[index];
            if (!move || Date.now() >= deadline) return;
            settled.push(
              await this.call(worker, {
                id: this.nextReqId(),
                type: 'scoreRoots',
                state,
                moves: [move],
                depth,
                options: sliceOpts,
              }),
            );
          }
        }),
      );

      const scored = new Map<string, { move: LegalMove; score: number }>();
      let allChunksComplete = true;

      for (const res of settled) {
        if (res.type !== 'scoreRoots') continue;
        if (!res.completed) allChunksComplete = false;
        for (const { move, score } of res.results) {
          scored.set(moveKey(move), { move, score });
        }
      }

      const complete = allChunksComplete && scored.size >= rootMoves.length;

      let iterBest = bestMove;
      let iterScore = -INF;
      let any = false;
      for (const { move, score } of scored.values()) {
        any = true;
        const adjusted = score + rootNoise(move, skill, depth);
        if (adjusted > iterScore) {
          iterScore = adjusted;
          iterBest = move;
        }
      }

      if (!any) break;

      if (complete) {
        bestMove = iterBest;
        bestScore = iterScore;
      } else if (depth === 1) {
        // Depth 1 must pick something even if time is tight.
        bestMove = iterBest;
        bestScore = iterScore;
      } else {
        // Incomplete deeper iteration: never overwrite a completed shallow PV
        // unless we found a forced mate among the moves that did finish.
        if (iterScore > 500_000) {
          bestMove = iterBest;
          bestScore = iterScore;
        }
        break;
      }

      if (bestScore > 500_000) break;
      if (Date.now() >= deadline) break;
    }

    this.rootPv.set(positionKey, moveKey(bestMove));
    if (this.rootPv.size > 256) {
      const oldest = this.rootPv.keys().next().value as number | undefined;
      if (oldest !== undefined) this.rootPv.delete(oldest);
    }
    return moveToCommand(bestMove);
  }

  /**
   * Live analysis search. Preempts any previous analysis (does not wait in the AI queue).
   * Threads > 1: Lazy SMP — N independent iterative searches (loads cores; UI gets
   * real depth/nodes/PV from searchStockfish progress callbacks).
   */
  async searchPosition(
    state: MatchState,
    options: ChooseOptions = {},
    analysis: { onProgress?: (result: SearchResult) => void } = {},
  ): Promise<SearchResult> {
    const requested = Math.max(1, Math.floor(options.workers ?? 1));
    // Full searches are not limited by root-move count (unlike root-split battle search).
    const workerCount = Math.max(1, Math.min(requested, 32));

    if (workerCount <= 1) {
      return this.searchPositionSingle(state, options, analysis);
    }
    return this.searchPositionLazySmp(state, options, workerCount, analysis);
  }

  private async searchPositionSingle(
    state: MatchState,
    options: ChooseOptions,
    analysis: { onProgress?: (result: SearchResult) => void },
  ): Promise<SearchResult> {
    const [worker] = this.spawnAnalysisWorkers(1);
    const res = await this.callAnalysis(
      worker!,
      {
        id: this.nextReqId(),
        type: 'searchPosition',
        state,
        options: {
          ...options,
          skill: 10,
          ttBits: Math.min(18, options.ttBits ?? 17),
          workers: 1,
        },
      },
      analysis.onProgress,
    );
    if (res.type !== 'searchPosition') throw new Error('unexpected worker response');
    return res.result;
  }

  /**
   * Lazy SMP: N independent searches. First worker to finish maxDepth wins;
   * siblings are aborted so we don't wait on the slowest core.
   */
  private async searchPositionLazySmp(
    state: MatchState,
    options: ChooseOptions,
    workerCount: number,
    analysis: { onProgress?: (result: SearchResult) => void },
  ): Promise<SearchResult> {
    const workers = this.spawnAnalysisWorkers(workerCount);
    const targetDepth = Math.max(1, options.maxDepth ?? options.depth ?? 14);
    const ttBits = Math.min(
      workerCount >= 8 ? 16 : 17,
      options.ttBits ?? 17,
    );
    const searchOpts: ChooseOptions = {
      ...options,
      skill: 10,
      ttBits,
      workers: 1,
    };

    let best: SearchResult | null = null;
    let winnerId: number | null = null;

    const consider = (partial: SearchResult) => {
      if (
        !best ||
        partial.depth > best.depth ||
        (partial.depth === best.depth && partial.nodes > best.nodes)
      ) {
        best = partial;
        analysis.onProgress?.(partial);
      }
    };

    const tasks = workers.map(async (worker) => {
      const id = this.nextReqId();
      try {
        const res = await this.callAnalysis(
          worker,
          {
            id,
            type: 'searchPosition',
            state,
            options: searchOpts,
          },
          consider,
        );
        if (res.type !== 'searchPosition') {
          throw new Error('unexpected worker response');
        }
        consider(res.result);
        if (res.result.depth >= targetDepth && winnerId === null) {
          winnerId = id;
          this.abortAnalysisExcept(new Set([id]));
        }
        return res.result;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return null;
        }
        throw err;
      }
    });

    await Promise.all(tasks);
    if (!best) {
      throw new DOMException('Analysis superseded', 'AbortError');
    }
    return best;
  }

  /**
   * Full-game throughput: N workers each pull the next mainline position.
   * Much better wall-clock than Lazy-SMP-per-position when analyzing dozens of plies.
   */
  async searchPositionQueue(
    states: MatchState[],
    options: ChooseOptions,
    opts: {
      concurrency: number;
      signal?: AbortSignal;
      /** Override search opts per position (e.g. resume from cached depth). */
      optionsForState?: (state: MatchState, index: number) => ChooseOptions;
      onProgress?: (info: {
        index: number;
        state: MatchState;
        partial: SearchResult;
      }) => void;
      onDone?: (info: {
        index: number;
        state: MatchState;
        result: SearchResult;
      }) => void;
    },
  ): Promise<SearchResult[]> {
    if (states.length === 0) return [];
    const concurrency = Math.max(1, Math.min(32, opts.concurrency, states.length));
    const workers = this.spawnAnalysisWorkers(concurrency);

    const results: Array<SearchResult | undefined> = new Array(states.length);
    let next = 0;

    const run = async (worker: Worker) => {
      for (;;) {
        if (opts.signal?.aborted) {
          throw new DOMException('Analysis cancelled', 'AbortError');
        }
        const index = next;
        next += 1;
        if (index >= states.length) return;
        const state = states[index]!;
        const perState = opts.optionsForState?.(state, index) ?? options;
        const callOpts: ChooseOptions = {
          ...perState,
          skill: 10,
          workers: 1,
          ttBits: Math.min(perState.ttBits ?? 17, concurrency >= 6 ? 16 : 17),
        };
        const res = await this.callAnalysis(
          worker,
          {
            id: this.nextReqId(),
            type: 'searchPosition',
            state,
            options: callOpts,
          },
          (partial) => {
            if (opts.signal?.aborted) return;
            opts.onProgress?.({ index, state, partial });
          },
        );
        if (opts.signal?.aborted) {
          throw new DOMException('Analysis cancelled', 'AbortError');
        }
        if (res.type !== 'searchPosition') {
          throw new Error('unexpected worker response');
        }
        results[index] = res.result;
        opts.onDone?.({ index, state, result: res.result });
      }
    };

    await Promise.all(workers.map((w) => run(w)));
    return results.map((r, i) => {
      if (!r) throw new Error(`missing search result for position ${i}`);
      return r;
    });
  }

  async searchScoreCommand(
    state: MatchState,
    command: GameCommand,
    options: ChooseOptions = {},
  ): Promise<number> {
    return this.enqueue(async () => {
      this.ensureWorkers(1);
      const res = await this.call(this.workers[0]!, {
        id: this.nextReqId(),
        type: 'scoreCommand',
        state,
        command,
        options,
      });
      if (res.type !== 'scoreCommand') throw new Error('unexpected worker response');
      return res.score;
    });
  }

  async searchScoreWhiteAfter(
    state: MatchState,
    command: GameCommand,
    options: ChooseOptions = {},
  ): Promise<number> {
    return this.enqueue(async () => {
      this.ensureWorkers(1);
      const res = await this.call(this.workers[0]!, {
        id: this.nextReqId(),
        type: 'scoreWhiteAfter',
        state,
        command,
        options,
      });
      if (res.type !== 'scoreWhiteAfter') throw new Error('unexpected worker response');
      return res.score;
    });
  }

  /** Stop live analysis immediately (e.g. when leaving the board / changing position). */
  cancelAnalysis(): void {
    this.killAnalysisWorkers();
  }

  dispose(): void {
    this.killAnalysisWorkers();
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.pending.clear();
  }
}

let shared: AiWorkerPool | null = null;

export function getAiPool(): AiWorkerPool {
  if (!shared) shared = new AiWorkerPool();
  return shared;
}
