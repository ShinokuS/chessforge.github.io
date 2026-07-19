import type { PlayerId } from '@chessforge/engine';

export type AiStrength = 'easy' | 'medium' | 'hard';

export const AI_STRENGTH: Record<
  AiStrength,
  { label: string; depth: number; hint: string }
> = {
  easy: { label: 'Лёгкий', depth: 1, hint: 'глубина 1' },
  medium: { label: 'Средний', depth: 2, hint: 'глубина 2' },
  hard: { label: 'Сильный', depth: 3, hint: 'глубина 3' },
};

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
