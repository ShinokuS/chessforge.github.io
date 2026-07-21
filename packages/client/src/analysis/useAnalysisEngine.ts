import { useEffect, useRef, useState } from 'react';
import {
  evaluateSearch,
  hashPosition,
  type BotId,
  type ChooseOptions,
  type SearchResult,
} from '@chessforge/ai';
import { getLegalMoves, type GameCommand, type MatchState } from '@chessforge/engine';
import { getAiPool } from '../ai/AiWorkerPool';
import type { AnalysisLine } from '../ai/AiWorkerPool';
import {
  clampAnalysisDepth,
  clampAnalysisThreads,
  buildAnalysisSearchOptions,
  DEFAULT_ANALYSIS_BOT_ID,
  type AnalysisDepth,
  type AnalysisThreads,
} from './analysisSettings';
import {
  loadEvalCacheFromStorage,
  schedulePersistEvalCache,
} from './evalCacheStorage';

export type EngineLine = AnalysisLine;

export type AnalysisEngineState = {
  enabled: boolean;
  running: boolean;
  lines: EngineLine[];
  error: string | null;
};

export type AnalysisEngineOptions = {
  depth: AnalysisDepth;
  threads: AnalysisThreads;
  botId?: BotId;
};

type CacheEntry = {
  line: EngineLine;
  reachedDepth: number;
};

/** Position → best known eval (survives navigation; used by move list + panel). */
const evalByPosition = new Map<number, EngineLine>();

const cacheListeners = new Set<() => void>();

function notifyEvalCache(): void {
  for (const listener of cacheListeners) listener();
}

/** Subscribe to eval-cache writes (graph / move-list refresh). */
export function subscribeEvalCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

function seedFromStorage(): void {
  if (evalByPosition.size > 0) return;
  for (const [hash, line] of loadEvalCacheFromStorage()) {
    evalByPosition.set(hash, line);
  }
}

seedFromStorage();

export function getCachedEval(state: MatchState): EngineLine | null {
  return evalByPosition.get(hashPosition(state)) ?? null;
}

/** Public write for full-game analysis / hydration. */
export function putCachedEval(state: MatchState, line: EngineLine): void {
  rememberEval(state, line);
}

/** Drop cached evals for the given positions (e.g. before re-running full-game analysis). */
export function clearCachedEvalsForStates(states: MatchState[]): void {
  let removed = 0;
  for (const state of states) {
    if (evalByPosition.delete(hashPosition(state))) removed += 1;
  }
  if (removed === 0) return;
  schedulePersistEvalCache(evalByPosition);
  notifyEvalCache();
}

function rememberEval(state: MatchState, line: EngineLine): void {
  const key = hashPosition(state);
  const prev = evalByPosition.get(key);
  if (prev && prev.depth > line.depth) return;
  if (
    prev &&
    prev.depth === line.depth &&
    prev.scoreWhite === line.scoreWhite &&
    prev.nodes === line.nodes
  ) {
    return;
  }
  evalByPosition.set(key, line);
  if (evalByPosition.size > 2_500) {
    let worstKey: number | undefined;
    let worstDepth = Infinity;
    for (const [h, v] of evalByPosition) {
      if (v.depth < worstDepth) {
        worstDepth = v.depth;
        worstKey = h;
      }
    }
    if (worstKey !== undefined) evalByPosition.delete(worstKey);
  }
  schedulePersistEvalCache(evalByPosition);
  notifyEvalCache();
}

/** Live: ∞ time until maxDepth; same depth ramp as full-game. */
function analysisOptions(
  maxDepth: number,
  startDepth: number,
  botId: BotId,
  threads: number,
): ChooseOptions {
  return {
    ...buildAnalysisSearchOptions({ maxDepth, startDepth, engine: botId }),
    workers: threads,
  };
}

function cacheKey(positionHash: number): string {
  return String(positionHash);
}

function firstMove(state: MatchState): GameCommand {
  const moves = getLegalMoves(state);
  if (moves.length === 0) return { type: 'endTurn' };
  const m = moves[0]!;
  return {
    type: 'move',
    from: { ...m.from },
    to: { ...m.to },
    ...(m.abilityId !== undefined ? { abilityId: m.abilityId } : {}),
    ...(m.push ? { push: true } : {}),
  };
}

function staticLine(state: MatchState): EngineLine {
  const score = evaluateSearch(state, state.activePlayer);
  const best = firstMove(state);
  return {
    scoreWhite: state.activePlayer === 'white' ? score : -score,
    depth: 0,
    nodes: 0,
    nps: 0,
    pv: [best],
    best,
    elapsedMs: 0,
  };
}

function toLine(result: SearchResult): EngineLine {
  return {
    scoreWhite: result.scoreWhite,
    depth: result.depth,
    nodes: result.nodes,
    nps: result.nps,
    pv: result.pv.length > 0 ? result.pv : [result.best],
    best: result.best,
    elapsedMs: result.elapsedMs,
  };
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * While > 0, live-engine effect cleanups must not kill analysis workers —
 * full-game analysis reuses the same pool and would otherwise be aborted
 * the moment the live engine disables.
 */
let exclusiveAnalysisDepth = 0;
let exclusiveAnalysisGen = 0;

/** Start exclusive full-game analysis; returns a token for endExclusiveAnalysis. */
export function beginExclusiveAnalysis(): number {
  exclusiveAnalysisGen += 1;
  exclusiveAnalysisDepth = 1;
  getAiPool().cancelAnalysis();
  return exclusiveAnalysisGen;
}

/** Release exclusive hold only if this token is still current. */
export function endExclusiveAnalysis(token?: number): void {
  if (token !== undefined && token !== exclusiveAnalysisGen) return;
  exclusiveAnalysisDepth = 0;
}

/**
 * Live position analysis with a persistent eval cache (Lichess-style).
 * Always searches until maxDepth (∞ time). Cache only paints instantly and
 * prevents UI score regression — it must never block a new search forever.
 */
export function useAnalysisEngine(
  state: MatchState,
  enabled: boolean,
  options: AnalysisEngineOptions,
): AnalysisEngineState {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);
  const cacheRef = useRef(new Map<string, CacheEntry>());

  const maxDepth = clampAnalysisDepth(options.depth);
  const threads = clampAnalysisThreads(options.threads);
  const botId = options.botId ?? DEFAULT_ANALYSIS_BOT_ID;
  const positionHash = hashPosition(state);

  useEffect(() => {
    if (!enabled || state.phase !== 'play') {
      setRunning(false);
      if (!enabled) {
        setLines([]);
        setError(null);
      }
      return;
    }

    const key = cacheKey(positionHash);
    const known = getCachedEval(state);
    const session = cacheRef.current.get(key);
    const painted = session?.line ?? known ?? staticLine(state);

    setLines([painted]);
    setError(null);
    if (!known || known.depth === 0) rememberEval(state, painted);
    if (!session) {
      cacheRef.current.set(key, { line: painted, reachedDepth: painted.depth });
    } else if (known && known.depth > session.reachedDepth) {
      cacheRef.current.set(key, { line: known, reachedDepth: known.depth });
    }

    const cachedDepth = Math.max(session?.reachedDepth ?? 0, known?.depth ?? 0);
    const hasRealSearch = cachedDepth > 0 && (known?.nodes ?? session?.line.nodes ?? 0) > 200;
    const doneHere = hasRealSearch && cachedDepth >= maxDepth;
    if (doneHere) {
      setRunning(false);
      return;
    }

    const startDepth =
      hasRealSearch && cachedDepth < maxDepth ? Math.min(maxDepth, cachedDepth + 1) : 1;

    const gen = ++genRef.current;
    let cancelled = false;
    setRunning(true);

    void (async () => {
      const pool = getAiPool();
      try {
        const applyPartial = (result: SearchResult) => {
          if (cancelled || genRef.current !== gen) return;
          if (hashPosition(state) !== positionHash) return;
          const prev = cacheRef.current.get(key);
          if (prev && result.depth < prev.reachedDepth) return;

          const line = toLine(result);
          setLines([line]);
          rememberEval(state, line);
          cacheRef.current.set(key, { line, reachedDepth: result.depth });
          if (cacheRef.current.size > 256) {
            const first = cacheRef.current.keys().next().value;
            if (first !== undefined) cacheRef.current.delete(first);
          }
        };

        const result = await pool.searchPosition(
          state,
          analysisOptions(maxDepth, startDepth, botId, threads),
          { onProgress: applyPartial },
        );
        if (cancelled || genRef.current !== gen) return;
        applyPartial(result);
      } catch (err) {
        if (isAbort(err) || cancelled || genRef.current !== gen) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled && genRef.current === gen) setRunning(false);
      }
    })();

    return () => {
      cancelled = true;
      if (exclusiveAnalysisDepth > 0) return;
      if (genRef.current === gen) {
        getAiPool().cancelAnalysis();
      }
    };
  }, [positionHash, enabled, maxDepth, threads, botId, state]);

  return { enabled, running, lines, error };
}
