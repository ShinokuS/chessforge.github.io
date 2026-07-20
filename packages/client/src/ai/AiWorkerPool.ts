import { getLegalMoves, type GameCommand, type LegalMove, type MatchState } from '@chessforge/engine';
import type { ChooseOptions, SearchResult } from '@chessforge/ai';
import type { WorkerRequest, WorkerResponse } from './search.worker';

const INF = 1_500_000;

type Pending = {
  resolve: (v: WorkerResponse) => void;
  reject: (e: Error) => void;
};

function hardwareWorkers(): number {
  if (typeof navigator === 'undefined') return 2;
  const n = navigator.hardwareConcurrency || 4;
  // Use every logical core (capped) — search runs off the UI thread.
  return Math.max(2, Math.min(8, n));
}

function partitionMoves<T>(items: T[], parts: number): T[][] {
  const n = Math.max(1, parts);
  const out: T[][] = Array.from({ length: n }, () => []);
  items.forEach((item, i) => {
    out[i % n]!.push(item);
  });
  return out.filter((c) => c.length > 0);
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

  private ensureWorkers(count: number): void {
    while (this.workers.length < count) {
      const w = new Worker(new URL('./search.worker.ts', import.meta.url), {
        type: 'module',
      });
      w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.type === 'error') p.reject(new Error(msg.message));
        else p.resolve(msg);
      };
      w.onerror = (err) => {
        console.error('AI worker error', err);
      };
      this.workers.push(w);
    }
  }

  private call(worker: Worker, req: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      worker.postMessage(req);
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

    const workerCount = Math.min(hardwareWorkers(), Math.max(1, rootMoves.length));
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

    let bestMove = rootMoves[0]!;
    let bestScore = -INF;

    for (let depth = 1; depth <= maxDepth; depth++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0 && depth > 1) break;

      // Prefer previous PV first so incomplete iterations still re-check it.
      const ordered = [
        bestMove,
        ...rootMoves.filter((m) => moveKey(m) !== moveKey(bestMove)),
      ];
      const chunks = partitionMoves(ordered, workerCount);

      // Parallel workers search different moves — each keeps nearly the full
      // node budget; wall-clock is bounded by `remaining`.
      const perNodes = Math.max(8_000, nodeLimit);
      const sliceOpts: ChooseOptions = {
        timeMs: Math.max(40, remaining),
        nodeLimit: perNodes,
        ttBits,
        skill: 10,
        maxDepth: depth,
      };

      const settled = await Promise.all(
        chunks.map((chunk, i) =>
          this.call(this.workers[i]!, {
            id: this.nextReqId(),
            type: 'scoreRoots',
            state,
            moves: chunk,
            depth,
            options: sliceOpts,
          }),
        ),
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

    return moveToCommand(bestMove);
  }

  async searchPosition(state: MatchState, options: ChooseOptions = {}): Promise<SearchResult> {
    return this.enqueue(async () => {
      this.ensureWorkers(1);
      const res = await this.call(this.workers[0]!, {
        id: this.nextReqId(),
        type: 'searchPosition',
        state,
        options,
      });
      if (res.type !== 'searchPosition') throw new Error('unexpected worker response');
      return res.result;
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

  dispose(): void {
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
