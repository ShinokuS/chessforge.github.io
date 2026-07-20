import { hashPosition } from '@chessforge/ai';
import type { MatchState } from '@chessforge/engine';
import type { MoveJudgment, MoveJudgmentInfo } from './moveJudgment';

const STORAGE_KEY = 'chessforge.move-judgments.v1';
const MAX_ENTRIES = 4_000;
const SAVE_DEBOUNCE_MS = 400;

export type PersistedJudgment = {
  judgment: MoveJudgment;
  winDrop: number;
  evalBefore: number;
  evalAfter: number;
  sameAsBest: boolean;
};

type StoredPayload = {
  version: 1;
  entries: Array<[string, PersistedJudgment]>;
};

const JUDGMENTS: ReadonlySet<string> = new Set([
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
]);

/** In-memory mirror (hash → judgment). */
const judgmentByHash = new Map<number, PersistedJudgment>();

let memoryFallback: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let seeded = false;

function storageGet(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return memoryFallback;
  }
}

function storageSet(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
    memoryFallback = null;
  } catch {
    memoryFallback = value;
  }
}

function parseJudgment(raw: unknown): PersistedJudgment | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<PersistedJudgment>;
  if (typeof o.judgment !== 'string' || !JUDGMENTS.has(o.judgment)) return null;
  if (typeof o.winDrop !== 'number' || typeof o.evalBefore !== 'number') return null;
  if (typeof o.evalAfter !== 'number' || typeof o.sameAsBest !== 'boolean') return null;
  return {
    judgment: o.judgment as MoveJudgment,
    winDrop: o.winDrop,
    evalBefore: o.evalBefore,
    evalAfter: o.evalAfter,
    sameAsBest: o.sameAsBest,
  };
}

function seedFromStorage(): void {
  if (seeded) return;
  seeded = true;
  const raw = storageGet();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as StoredPayload;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
    for (const pair of parsed.entries) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const hash = Number(pair[0]);
      if (!Number.isFinite(hash)) continue;
      const j = parseJudgment(pair[1]);
      if (!j) continue;
      judgmentByHash.set(hash, j);
    }
  } catch {
    /* ignore corrupt cache */
  }
}

seedFromStorage();

function persistNow(): void {
  const entries: StoredPayload['entries'] = [];
  for (const [hash, j] of judgmentByHash) {
    entries.push([String(hash), j]);
  }
  if (entries.length > MAX_ENTRIES) {
    // Drop oldest-ish by keeping the tail (Map insertion order).
    const keep = entries.slice(entries.length - MAX_ENTRIES);
    judgmentByHash.clear();
    for (const [h, j] of keep) {
      judgmentByHash.set(Number(h), j);
    }
    storageSet(JSON.stringify({ version: 1, entries: keep } satisfies StoredPayload));
    return;
  }
  storageSet(JSON.stringify({ version: 1, entries } satisfies StoredPayload));
}

function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow();
  }, SAVE_DEBOUNCE_MS);
}

export function getCachedJudgment(state: MatchState): MoveJudgmentInfo | null {
  seedFromStorage();
  return judgmentByHash.get(hashPosition(state)) ?? null;
}

export function putCachedJudgment(state: MatchState, info: MoveJudgmentInfo): void {
  seedFromStorage();
  judgmentByHash.set(hashPosition(state), {
    judgment: info.judgment,
    winDrop: info.winDrop,
    evalBefore: info.evalBefore,
    evalAfter: info.evalAfter,
    sameAsBest: info.sameAsBest,
  });
  schedulePersist();
}

/** Write many judgments; one debounce flush. */
export function putCachedJudgments(
  items: Array<{ state: MatchState; info: MoveJudgmentInfo }>,
): void {
  seedFromStorage();
  for (const { state, info } of items) {
    judgmentByHash.set(hashPosition(state), {
      judgment: info.judgment,
      winDrop: info.winDrop,
      evalBefore: info.evalBefore,
      evalAfter: info.evalAfter,
      sameAsBest: info.sameAsBest,
    });
  }
  schedulePersist();
}

export function clearCachedJudgmentsForStates(states: MatchState[]): void {
  seedFromStorage();
  let removed = 0;
  for (const state of states) {
    if (judgmentByHash.delete(hashPosition(state))) removed += 1;
  }
  if (removed > 0) schedulePersist();
}
