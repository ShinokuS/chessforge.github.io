import type { GameCommand, MatchState } from '@chessforge/engine';
import {
  createRootNode,
  getNodeAt,
  playAtPath,
  type AnalysisNode,
  type AnalysisPath,
} from './analysisTree';
import type { StoredJudgmentEntry } from './moveJudgment';

const STORAGE_KEY = 'chessforge.analysis-sessions.v1';
const MAX_SESSIONS = 40;
const SAVE_DEBOUNCE_MS = 500;

export type StoredAnalysisNode = {
  command: GameCommand;
  children: StoredAnalysisNode[];
};

export type StoredAnalysisSession = {
  version: 1;
  gameId: string;
  savedAt: number;
  path: AnalysisPath;
  children: StoredAnalysisNode[];
  /** Lichess-style move marks from full-game analysis. */
  judgments?: StoredJudgmentEntry[];
};

type StoredPayload = {
  version: 1;
  sessions: StoredAnalysisSession[];
};

let memoryFallback: string | null = null;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

function readAll(): StoredAnalysisSession[] {
  const raw = storageGet();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredPayload;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sessions)) return [];
    return parsed.sessions.filter(
      (s) => s && typeof s.gameId === 'string' && Array.isArray(s.children),
    );
  } catch {
    return [];
  }
}

function writeAll(sessions: StoredAnalysisSession[]): void {
  storageSet(JSON.stringify({ version: 1, sessions } satisfies StoredPayload));
}

function serializeChildren(node: AnalysisNode): StoredAnalysisNode[] {
  const out: StoredAnalysisNode[] = [];
  for (const child of node.children) {
    if (!child.command) continue;
    out.push({
      command: structuredClone(child.command),
      children: serializeChildren(child),
    });
  }
  return out;
}

export function serializeAnalysisSession(
  gameId: string,
  root: AnalysisNode,
  path: AnalysisPath,
  judgments?: StoredJudgmentEntry[] | null,
): StoredAnalysisSession {
  return {
    version: 1,
    gameId,
    savedAt: Date.now(),
    path: [...path],
    children: serializeChildren(root),
    ...(judgments && judgments.length > 0 ? { judgments: judgments.map((j) => ({ ...j })) } : {}),
  };
}

function hydrateChildren(
  root: AnalysisNode,
  parentPath: AnalysisPath,
  kids: StoredAnalysisNode[],
): AnalysisNode {
  let cur = root;
  for (const kid of kids) {
    const next = playAtPath(cur, parentPath, kid.command);
    if (!next) continue;
    cur = next.root;
    if (kid.children.length > 0) {
      cur = hydrateChildren(cur, next.path, kid.children);
    }
  }
  return cur;
}

export function hydrateAnalysisSession(
  opening: MatchState,
  session: StoredAnalysisSession,
): { root: AnalysisNode; path: AnalysisPath } {
  let root = createRootNode(opening);
  root = hydrateChildren(root, [], session.children);
  const path = [...(session.path ?? [])];
  if (getNodeAt(root, path)) return { root, path };
  // Fallback: end of mainline.
  let end: AnalysisPath = [];
  let node = root;
  while (node.children[0]) {
    end = [...end, 0];
    node = node.children[0];
  }
  return { root, path: end };
}

export function loadAnalysisSession(gameId: string): StoredAnalysisSession | null {
  return readAll().find((s) => s.gameId === gameId) ?? null;
}

export function saveAnalysisSession(session: StoredAnalysisSession): void {
  const next = [
    session,
    ...readAll().filter((s) => s.gameId !== session.gameId),
  ].slice(0, MAX_SESSIONS);
  writeAll(next);
}

export function scheduleSaveAnalysisSession(session: StoredAnalysisSession): void {
  const prev = saveTimers.get(session.gameId);
  if (prev) clearTimeout(prev);
  saveTimers.set(
    session.gameId,
    setTimeout(() => {
      saveTimers.delete(session.gameId);
      saveAnalysisSession(session);
    }, SAVE_DEBOUNCE_MS),
  );
}

export function deleteAnalysisSession(gameId: string): void {
  const prev = saveTimers.get(gameId);
  if (prev) clearTimeout(prev);
  saveTimers.delete(gameId);
  writeAll(readAll().filter((s) => s.gameId !== gameId));
}
