import type { PlayerId } from '@chessforge/engine';

/** Default sudden-death clock per side. */
export const INITIAL_CLOCK_MS = 10 * 60 * 1000;

export type MatchClocks = {
  whiteMs: number;
  blackMs: number;
  /** Whose clock is ticking; null when paused. */
  active: PlayerId | null;
  lastTickAt: number | null;
};

export function freshClocks(
  active: PlayerId | null = null,
  initialMs: number = INITIAL_CLOCK_MS,
): MatchClocks {
  return {
    whiteMs: initialMs,
    blackMs: initialMs,
    active,
    lastTickAt: active ? Date.now() : null,
  };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Apply elapsed time to the active side. Returns timeout winner if any. */
export function advanceClocks(
  clocks: MatchClocks,
  now = Date.now(),
): { clocks: MatchClocks; timeoutWinner: PlayerId | null } {
  if (!clocks.active || clocks.lastTickAt === null) {
    return { clocks, timeoutWinner: null };
  }
  const elapsed = Math.max(0, now - clocks.lastTickAt);
  if (elapsed === 0) return { clocks, timeoutWinner: null };

  const next: MatchClocks = { ...clocks, lastTickAt: now };
  if (clocks.active === 'white') {
    next.whiteMs = clocks.whiteMs - elapsed;
    if (next.whiteMs <= 0) {
      next.whiteMs = 0;
      next.active = null;
      next.lastTickAt = null;
      return { clocks: next, timeoutWinner: 'black' };
    }
  } else {
    next.blackMs = clocks.blackMs - elapsed;
    if (next.blackMs <= 0) {
      next.blackMs = 0;
      next.active = null;
      next.lastTickAt = null;
      return { clocks: next, timeoutWinner: 'white' };
    }
  }
  return { clocks: next, timeoutWinner: null };
}

export function switchClock(clocks: MatchClocks, nextActive: PlayerId, now = Date.now()): MatchClocks {
  const stepped = advanceClocks(clocks, now).clocks;
  return {
    ...stepped,
    active: nextActive,
    lastTickAt: now,
  };
}
