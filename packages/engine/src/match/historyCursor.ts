import type { MoveHistoryEntry } from './history.js';

/** Whether a 1-based position cursor / lastPly falls inside this history cell. */
export function historyCursorInEntry(cursor: number, entry: MoveHistoryEntry | undefined): boolean {
  if (!entry || entry.kind !== 'ply' || cursor <= 0) return false;
  const end = entry.endPly ?? entry.ply;
  return cursor >= entry.ply && cursor <= end;
}

/** Jump target after clicking a merged history cell (end of the combined action). */
export function historyCursorForEntry(entry: MoveHistoryEntry): number {
  return entry.endPly ?? entry.ply;
}
