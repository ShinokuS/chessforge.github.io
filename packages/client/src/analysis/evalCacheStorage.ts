import type { GameCommand } from '@chessforge/engine';

const STORAGE_KEY = 'chessforge.eval-cache.v3';
const MAX_ENTRIES = 2_000;
const SAVE_DEBOUNCE_MS = 400;

export type PersistedEngineLine = {
  scoreWhite: number;
  depth: number;
  nodes: number;
  nps: number;
  elapsedMs: number;
  best: GameCommand;
  pv: GameCommand[];
};

type StoredPayload = {
  version: 3;
  entries: Array<[string, PersistedEngineLine]>;
};

let memoryFallback: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

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

function isCommand(v: unknown): v is GameCommand {
  if (!v || typeof v !== 'object') return false;
  const t = (v as { type?: unknown }).type;
  return t === 'move' || t === 'endTurn';
}

function parseLine(raw: unknown): PersistedEngineLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<PersistedEngineLine>;
  if (typeof o.scoreWhite !== 'number' || typeof o.depth !== 'number') return null;
  if (!isCommand(o.best)) return null;
  const pv = Array.isArray(o.pv) ? o.pv.filter(isCommand) : [o.best];
  return {
    scoreWhite: o.scoreWhite,
    depth: o.depth,
    nodes: typeof o.nodes === 'number' ? o.nodes : 0,
    nps: typeof o.nps === 'number' ? o.nps : 0,
    elapsedMs: typeof o.elapsedMs === 'number' ? o.elapsedMs : 0,
    best: o.best,
    pv: pv.length > 0 ? pv : [o.best],
  };
}

/** Load persisted evals into a map (hash → line). */
export function loadEvalCacheFromStorage(): Map<number, PersistedEngineLine> {
  const out = new Map<number, PersistedEngineLine>();
  const raw = storageGet();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as StoredPayload;
    if (!parsed || parsed.version !== 3 || !Array.isArray(parsed.entries)) return out;
    for (const pair of parsed.entries) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const hash = Number(pair[0]);
      if (!Number.isFinite(hash)) continue;
      const line = parseLine(pair[1]);
      if (!line) continue;
      out.set(hash, line);
    }
  } catch {
    return out;
  }
  return out;
}

export function persistEvalCacheToStorage(cache: Map<number, PersistedEngineLine>): void {
  const entries: StoredPayload['entries'] = [];
  for (const [hash, line] of cache) {
    if (line.depth <= 0) continue;
    entries.push([
      String(hash),
      {
        scoreWhite: line.scoreWhite,
        depth: line.depth,
        nodes: line.nodes,
        nps: line.nps,
        elapsedMs: line.elapsedMs,
        best: line.best,
        pv: line.pv.slice(0, 12),
      },
    ]);
  }
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => (b[1].depth - a[1].depth) || (b[1].nodes - a[1].nodes));
    entries.length = MAX_ENTRIES;
  }
  storageSet(JSON.stringify({ version: 3, entries } satisfies StoredPayload));
}

export function schedulePersistEvalCache(cache: Map<number, PersistedEngineLine>): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistEvalCacheToStorage(cache);
  }, SAVE_DEBOUNCE_MS);
}
