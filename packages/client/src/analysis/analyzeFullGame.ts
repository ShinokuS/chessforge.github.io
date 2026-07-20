import { hashPosition, type SearchResult } from '@chessforge/ai';
import type { MatchState } from '@chessforge/engine';
import { getAiPool } from '../ai/AiWorkerPool';
import type { EngineLine } from './useAnalysisEngine';
import { clearCachedEvalsForStates, putCachedEval } from './useAnalysisEngine';
import {
  getNodeAt,
  mainlineGraphPaths,
  type AnalysisNode,
} from './analysisTree';
import {
  ANALYSIS_DEPTH_SLICE_MS,
  buildAnalysisSearchOptions,
  defaultAnalysisThreads,
} from './analysisSettings';

/** Every mainline position is searched to this depth (same target as live). */
export const FULL_GAME_DEPTH = 14;

export type FullGameProgress = {
  done: number;
  total: number;
  currentDepth: number;
  targetDepth: number;
  startedAt: number;
  elapsedMs: number;
  budgetMs: number;
  etaMs: number | null;
  skipped: number;
  /** Active parallel workers. */
  sliceMs: number;
};

export type FullGameAnalysisOptions = {
  depth?: number;
  /** Parallel workers (= analysis threads). */
  threads?: number;
  signal?: AbortSignal;
  onProgress?: (p: FullGameProgress) => void;
};

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

function collectMainlineStates(root: AnalysisNode): MatchState[] {
  const paths = mainlineGraphPaths(root);
  const out: MatchState[] = [];
  const seen = new Set<number>();
  for (const path of paths) {
    const node = getNodeAt(root, path);
    const state = node?.state ?? root.state;
    if (state.phase !== 'play') continue;
    const key = hashPosition(state);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(state);
  }
  return out;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Full-game analysis:
 * - each mainline position ramps to target depth (~200ms per step, same as live);
 * - N worker threads each pull the next position (real parallelism).
 */
export async function analyzeFullGame(
  root: AnalysisNode,
  options: FullGameAnalysisOptions = {},
): Promise<{ analyzed: number; skipped: number }> {
  const targetDepth = options.depth ?? FULL_GAME_DEPTH;
  const threads = Math.max(1, options.threads ?? defaultAnalysisThreads());
  const signal = options.signal;
  const states = collectMainlineStates(root);

  clearCachedEvalsForStates(states);

  const total = states.length;
  const startedAt = Date.now();
  let done = 0;
  let currentDepth = 0;
  const concurrency = Math.max(1, Math.min(threads, Math.max(1, total)));

  const emit = () => {
    const elapsedMs = Date.now() - startedAt;
    const finished = done;
    const etaMs =
      finished > 0 && finished < total
        ? Math.round((elapsedMs / finished) * (total - finished))
        : null;
    options.onProgress?.({
      done,
      total,
      currentDepth,
      targetDepth,
      startedAt,
      elapsedMs,
      budgetMs: 0,
      etaMs,
      skipped: 0,
      sliceMs: ANALYSIS_DEPTH_SLICE_MS,
    });
  };

  emit();
  if (total === 0) return { analyzed: 0, skipped: 0 };

  const pool = getAiPool();
  const searchOpts = buildAnalysisSearchOptions({ maxDepth: targetDepth });

  try {
    await pool.searchPositionQueue(states, searchOpts, {
      concurrency,
      ...(signal ? { signal } : {}),
      onProgress: ({ state, partial }) => {
        if (signal?.aborted) return;
        if (partial.depth < 1) return;
        putCachedEval(state, toLine(partial));
        currentDepth = Math.max(currentDepth, partial.depth);
        emit();
      },
      onDone: ({ state, result }) => {
        if (signal?.aborted) return;
        putCachedEval(state, toLine(result));
        currentDepth = Math.max(currentDepth, result.depth);
        done += 1;
        emit();
      },
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) {
      pool.cancelAnalysis();
      throw new DOMException('Analysis cancelled', 'AbortError');
    }
    throw err;
  }

  if (signal?.aborted) {
    pool.cancelAnalysis();
    throw new DOMException('Analysis cancelled', 'AbortError');
  }

  return { analyzed: done, skipped: 0 };
}

export function formatAnalysisEta(ms: number | null): string {
  if (ms === null) return '…';
  if (ms <= 0) return '0 с';
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatAnalysisElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fullGameProgressPercent(p: FullGameProgress): number {
  if (p.total <= 0) return 100;
  const within =
    p.done < p.total
      ? Math.min(0.92, p.currentDepth / Math.max(1, p.targetDepth))
      : 0;
  return Math.min(100, Math.round(((p.done + within) / p.total) * 100));
}
