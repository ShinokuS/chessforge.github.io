import type { PlayerId } from '@chessforge/engine';
import type { ChooseOptions } from '@chessforge/ai';

/** Discrete level: 0 = weakest, 10 = maximum search power (Lichess-style buttons). */
export type AiStrengthLevel = number;

export const AI_STRENGTH_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type AiSearchProfile = {
  level: AiStrengthLevel;
  label: string;
  hint: string;
  maxDepth: number;
  timeMs: number;
  nodeLimit: number;
  /** 0–10 passed to search; below 10 injects root noise. */
  skill: number;
  /** Transposition table size as power of two (14→16k … 18→262k). */
  ttBits: number;
};

const DEPTH_BY_LEVEL = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 18] as const;
const TIME_BY_LEVEL = [40, 60, 90, 130, 200, 320, 500, 800, 1_200, 1_800, 2_800] as const;
const NODES_BY_LEVEL = [
  2_000, 5_000, 12_000, 30_000, 70_000, 150_000, 350_000, 800_000, 1_800_000, 4_000_000, 10_000_000,
] as const;
const TT_BITS_BY_LEVEL = [14, 14, 15, 15, 16, 16, 17, 18, 18, 19, 20] as const;

export function clampAiStrength(level: number): AiStrengthLevel {
  if (!Number.isFinite(level)) return 5;
  return Math.max(0, Math.min(10, Math.round(level)));
}

export function aiSearchProfile(level: number): AiSearchProfile {
  const L = clampAiStrength(level);
  const maxDepth = DEPTH_BY_LEVEL[L]!;
  const timeMs = TIME_BY_LEVEL[L]!;
  const nodeLimit = NODES_BY_LEVEL[L]!;
  const ttBits = TT_BITS_BY_LEVEL[L]!;
  const seconds = timeMs >= 1000 ? `${(timeMs / 1000).toFixed(1)} с` : `${timeMs} мс`;
  return {
    level: L,
    label: `${L}/10`,
    hint:
      L === 0
        ? 'почти случайные ходы'
        : L === 10
          ? `максимум · до ~${seconds} · глубина ${maxDepth}`
          : `думает до ~${seconds} · глубина ${maxDepth}`,
    maxDepth,
    timeMs,
    nodeLimit,
    skill: L,
    ttBits,
  };
}

function defaultAiWorkers(): number {
  if (typeof navigator === 'undefined') return 2;
  const n = navigator.hardwareConcurrency || 4;
  return Math.max(2, Math.min(8, n));
}

export function aiChooseOptions(level: number): ChooseOptions {
  const p = aiSearchProfile(level);
  return {
    maxDepth: p.maxDepth,
    timeMs: p.timeMs,
    nodeLimit: p.nodeLimit,
    skill: p.skill,
    ttBits: p.ttBits,
    workers: defaultAiWorkers(),
    engine: 'stockfish',
  };
}

export type SidePreference = 'white' | 'black' | 'random';

export const SIDE_OPTIONS: { id: SidePreference; label: string }[] = [
  { id: 'white', label: 'Белые' },
  { id: 'black', label: 'Чёрные' },
  { id: 'random', label: 'Случайно' },
];

export type TimePresetId = '3' | '5' | '10' | '15';

export const TIME_PRESETS: {
  id: TimePresetId;
  label: string;
  ms: number;
}[] = [
  { id: '3', label: '3 мин', ms: 3 * 60 * 1000 },
  { id: '5', label: '5 мин', ms: 5 * 60 * 1000 },
  { id: '10', label: '10 мин', ms: 10 * 60 * 1000 },
  { id: '15', label: '15 мин', ms: 15 * 60 * 1000 },
];

export function timePresetMs(id: TimePresetId): number {
  return TIME_PRESETS.find((p) => p.id === id)?.ms ?? TIME_PRESETS[2]!.ms;
}

export function resolveSide(pref: SidePreference): PlayerId {
  if (pref === 'white') return 'white';
  if (pref === 'black') return 'black';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(1);
    crypto.getRandomValues(buf);
    return (buf[0]! & 1) === 0 ? 'white' : 'black';
  }
  return Math.random() < 0.5 ? 'white' : 'black';
}
