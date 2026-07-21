/** Analysis board engine settings (Lichess-style panel). */

import { clampBotId, DEFAULT_BOT_ID, type BotId, type ChooseOptions } from '@chessforge/ai';

export type AnalysisDepth = number;
export type AnalysisThreads = number;

/** @deprecated Live analysis is always ∞; kept for persisted store compat. */
export type AnalysisTimeMs = number;

export const ANALYSIS_DEPTH_OPTIONS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24] as const;

export const DEFAULT_ANALYSIS_TIME_MS: AnalysisTimeMs = 0;
export const DEFAULT_ANALYSIS_DEPTH: AnalysisDepth = 14;
export const DEFAULT_ANALYSIS_BOT_ID: BotId = DEFAULT_BOT_ID;

/** Ms budget per iterative-deepening step (live + full-game ramp). */
export const ANALYSIS_DEPTH_SLICE_MS = 200;

export function defaultAnalysisThreads(): AnalysisThreads {
  if (typeof navigator === 'undefined') return 2;
  const n = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(8, n));
}

export function clampAnalysisTimeMs(ms: number): AnalysisTimeMs {
  // Live no longer uses a time cap — always treat as ∞.
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return 0;
}

export function clampAnalysisDepth(depth: number): AnalysisDepth {
  if (!Number.isFinite(depth)) return DEFAULT_ANALYSIS_DEPTH;
  const rounded = Math.round(depth);
  const nearest = ANALYSIS_DEPTH_OPTIONS.reduce((best, d) =>
    Math.abs(d - rounded) < Math.abs(best - rounded) ? d : best,
  );
  return nearest;
}

/** No upper bound — only floor at 1. */
export function clampAnalysisThreads(threads: number): AnalysisThreads {
  if (!Number.isFinite(threads)) return defaultAnalysisThreads();
  return Math.max(1, Math.round(threads));
}

/** TT size from target depth (live is always ∞ time). */
export function analysisTtBits(depthOrTime: number): number {
  if (depthOrTime >= 20) return 18;
  if (depthOrTime >= 14) return 18;
  if (depthOrTime >= 10) return 16;
  return 15;
}

/** Shared live / full-game search contract: ∞ clock, fast depth ramp to maxDepth. */
export function buildAnalysisSearchOptions(input: {
  maxDepth: number;
  startDepth?: number;
  engine?: BotId;
}): ChooseOptions {
  const maxDepth = clampAnalysisDepth(input.maxDepth);
  return {
    maxDepth,
    startDepth: Math.max(1, Math.floor(input.startDepth ?? 1)),
    depthSliceMs: ANALYSIS_DEPTH_SLICE_MS,
    timeMs: 0,
    nodeLimit: 250_000_000,
    skill: 10,
    ttBits: Math.min(18, analysisTtBits(maxDepth)),
    engine: clampBotId(input.engine ?? DEFAULT_ANALYSIS_BOT_ID),
    workers: 1,
    fastAnalysis: true,
  };
}
