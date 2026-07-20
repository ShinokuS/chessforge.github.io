import type { GameCommand, MatchState, PlayerId } from '@chessforge/engine';
import type { EngineLine } from './useAnalysisEngine';
import { getCachedEval } from './useAnalysisEngine';
import {
  getCachedJudgment,
  putCachedJudgments,
} from './judgmentCacheStorage';
import {
  getNodeAt,
  mainlineGraphPaths,
  type AnalysisNode,
  type AnalysisPath,
  type TreeHistoryMove,
} from './analysisTree';

/** Same set as post-game battle analysis / Lichess-style labels. */
export type MoveJudgment =
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

export type MoveJudgmentInfo = {
  judgment: MoveJudgment;
  /** Win% drop for the side that moved (0..2 scale of pov chances). */
  winDrop: number;
  evalBefore: number;
  evalAfter: number;
  sameAsBest: boolean;
};

const JUDGMENT_RU: Record<MoveJudgment, string> = {
  best: 'Лучший',
  excellent: 'Отличный',
  good: 'Хороший',
  inaccuracy: 'Неточность',
  mistake: 'Ошибка',
  blunder: 'Зевок',
};

const JUDGMENT_GLYPH: Record<MoveJudgment, string> = {
  best: '★',
  excellent: '✦',
  good: '·',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

export function judgmentLabel(j: MoveJudgment): string {
  return JUDGMENT_RU[j];
}

export function judgmentGlyph(j: MoveJudgment): string {
  return JUDGMENT_GLYPH[j];
}

/**
 * Lichess winning-chances model: maps white-centric cp → [-1, +1].
 * Judgement thresholds (.1 / .2 / .3) apply on this scale.
 * @see lila Advice.scala / https://lichess.org/page/accuracy
 */
export function winningChances(cpWhite: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cpWhite));
  return 2 / (1 + Math.exp(-0.00368208 * clamped)) - 1;
}

/** Winning chances from the mover's point of view (−1..+1). */
export function povWinningChances(player: PlayerId, cpWhite: number): number {
  const w = winningChances(cpWhite);
  return player === 'white' ? w : -w;
}

/**
 * Classify by drop in winning chances (Lichess thresholds on −1..+1 scale):
 * ≥0.30 blunder, ≥0.20 mistake, ≥0.10 inaccuracy.
 * Below that: best / excellent / good by how close to optimal.
 */
export function classifyByWinChance(
  evalBeforeWhite: number,
  evalAfterWhite: number,
  player: PlayerId,
  sameAsBest: boolean,
): { judgment: MoveJudgment; winDrop: number } {
  const before = povWinningChances(player, evalBeforeWhite);
  const after = povWinningChances(player, evalAfterWhite);
  const winDrop = Math.max(0, before - after);

  if (winDrop >= 0.3) return { judgment: 'blunder', winDrop };
  if (winDrop >= 0.2) return { judgment: 'mistake', winDrop };
  if (winDrop >= 0.1) return { judgment: 'inaccuracy', winDrop };

  if (sameAsBest || winDrop <= 0.01) return { judgment: 'best', winDrop };
  if (winDrop <= 0.035) return { judgment: 'excellent', winDrop };
  return { judgment: 'good', winDrop };
}

/** Legacy cp-loss classify (battle post-game); prefer win% when both evals exist. */
export function classifyByCpLoss(loss: number, sameAsBest: boolean): MoveJudgment {
  if (sameAsBest || loss <= 20) return 'best';
  if (loss <= 50) return 'excellent';
  if (loss <= 90) return 'good';
  if (loss <= 160) return 'inaccuracy';
  if (loss <= 300) return 'mistake';
  return 'blunder';
}

function commandsEqual(a: GameCommand, b: GameCommand): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'move' && b.type === 'move') {
    return (
      a.from.x === b.from.x &&
      a.from.y === b.from.y &&
      a.to.x === b.to.x &&
      a.to.y === b.to.y &&
      (a.abilityId ?? '') === (b.abilityId ?? '') &&
      Boolean(a.push) === Boolean(b.push)
    );
  }
  return a.type === 'endTurn' && b.type === 'endTurn';
}

export function pathKey(path: AnalysisPath): string {
  return path.join('.');
}

/**
 * Build judgments for every mainline ply using cached full-game evals.
 * Keyed by the path of the position after the ply (`pathEnd` / graph path).
 * Also writes each judgment into the persistent judgment cache (by after-hash).
 */
export function buildMainlineJudgments(
  root: AnalysisNode,
  getEval: (state: MatchState) => EngineLine | null = getCachedEval,
): Map<string, MoveJudgmentInfo> {
  const paths = mainlineGraphPaths(root);
  const out = new Map<string, MoveJudgmentInfo>();
  const toCache: Array<{ state: MatchState; info: MoveJudgmentInfo }> = [];

  for (let i = 1; i < paths.length; i += 1) {
    const beforePath = paths[i - 1]!;
    const afterPath = paths[i]!;
    const beforeNode = getNodeAt(root, beforePath) ?? root;
    const afterNode = getNodeAt(root, afterPath);
    if (!afterNode) continue;

    const beforeLine = getEval(beforeNode.state);
    const afterLine = getEval(afterNode.state);
    if (!beforeLine || !afterLine) continue;

    const player = beforeNode.state.activePlayer;
    const firstMove = firstMoveCommand(beforeNode);
    const sameAsBest =
      firstMove !== null &&
      beforeLine.best != null &&
      commandsEqual(firstMove, beforeLine.best);

    const { judgment, winDrop } = classifyByWinChance(
      beforeLine.scoreWhite,
      afterLine.scoreWhite,
      player,
      sameAsBest,
    );

    const info: MoveJudgmentInfo = {
      judgment,
      winDrop,
      evalBefore: beforeLine.scoreWhite,
      evalAfter: afterLine.scoreWhite,
      sameAsBest,
    };
    out.set(pathKey(afterPath), info);
    toCache.push({ state: afterNode.state, info });
  }

  if (toCache.length > 0) {
    putCachedJudgments(toCache);
  }

  return out;
}

/**
 * Restore path→judgment map from persistent cache and/or eval cache.
 * Prefers stored judgments; fills gaps by recomputing from evals.
 */
export function restoreMainlineJudgments(root: AnalysisNode): Map<string, MoveJudgmentInfo> | null {
  const paths = mainlineGraphPaths(root);
  if (paths.length < 2) return null;

  const out = new Map<string, MoveJudgmentInfo>();
  let fromCache = 0;
  let fromEval = 0;

  for (let i = 1; i < paths.length; i += 1) {
    const beforePath = paths[i - 1]!;
    const afterPath = paths[i]!;
    const beforeNode = getNodeAt(root, beforePath) ?? root;
    const afterNode = getNodeAt(root, afterPath);
    if (!afterNode) continue;

    const cached = getCachedJudgment(afterNode.state);
    if (cached) {
      out.set(pathKey(afterPath), cached);
      fromCache += 1;
      continue;
    }

    const beforeLine = getCachedEval(beforeNode.state);
    const afterLine = getCachedEval(afterNode.state);
    if (!beforeLine || !afterLine) continue;

    const player = beforeNode.state.activePlayer;
    const firstMove = firstMoveCommand(beforeNode);
    const sameAsBest =
      firstMove !== null &&
      beforeLine.best != null &&
      commandsEqual(firstMove, beforeLine.best);
    const { judgment, winDrop } = classifyByWinChance(
      beforeLine.scoreWhite,
      afterLine.scoreWhite,
      player,
      sameAsBest,
    );
    const info: MoveJudgmentInfo = {
      judgment,
      winDrop,
      evalBefore: beforeLine.scoreWhite,
      evalAfter: afterLine.scoreWhite,
      sameAsBest,
    };
    out.set(pathKey(afterPath), info);
    fromEval += 1;
  }

  if (out.size === 0) return null;
  // If we rebuilt some from evals, persist them for next time.
  if (fromEval > 0) {
    const items: Array<{ state: MatchState; info: MoveJudgmentInfo }> = [];
    for (let i = 1; i < paths.length; i += 1) {
      const afterPath = paths[i]!;
      const info = out.get(pathKey(afterPath));
      const afterNode = getNodeAt(root, afterPath);
      if (info && afterNode) items.push({ state: afterNode.state, info });
    }
    putCachedJudgments(items);
  }

  // Only show marks if we covered a meaningful share of the mainline
  // (avoids partial noise from a couple of live-engine positions).
  const plies = paths.length - 1;
  if (fromCache + fromEval < Math.min(plies, Math.max(1, Math.ceil(plies * 0.5)))) {
    return fromCache > 0 ? out : null;
  }
  return out;
}

/** Serialize judgments for analysis-session storage. */
export function serializeJudgments(
  map: Map<string, MoveJudgmentInfo> | null,
): StoredJudgmentEntry[] | undefined {
  if (!map || map.size === 0) return undefined;
  return [...map.entries()].map(([path, info]) => ({
    path,
    judgment: info.judgment,
    winDrop: info.winDrop,
    evalBefore: info.evalBefore,
    evalAfter: info.evalAfter,
    sameAsBest: info.sameAsBest,
  }));
}

export function hydrateJudgments(
  entries: StoredJudgmentEntry[] | undefined,
): Map<string, MoveJudgmentInfo> | null {
  if (!entries || entries.length === 0) return null;
  const out = new Map<string, MoveJudgmentInfo>();
  for (const e of entries) {
    if (!e || typeof e.path !== 'string') continue;
    if (!JUDGMENT_SET.has(e.judgment)) continue;
    out.set(e.path, {
      judgment: e.judgment,
      winDrop: typeof e.winDrop === 'number' ? e.winDrop : 0,
      evalBefore: typeof e.evalBefore === 'number' ? e.evalBefore : 0,
      evalAfter: typeof e.evalAfter === 'number' ? e.evalAfter : 0,
      sameAsBest: Boolean(e.sameAsBest),
    });
  }
  return out.size > 0 ? out : null;
}

export type StoredJudgmentEntry = {
  path: string;
  judgment: MoveJudgment;
  winDrop: number;
  evalBefore: number;
  evalAfter: number;
  sameAsBest: boolean;
};

const JUDGMENT_SET: ReadonlySet<string> = new Set([
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
]);


/** First real move on the mainline from this node. */
function firstMoveCommand(beforeNode: AnalysisNode): GameCommand | null {
  const child = beforeNode.children[0];
  if (!child?.command) return null;
  if (child.command.type === 'endTurn') {
    const next = child.children[0];
    return next?.command?.type === 'move' ? next.command : child.command;
  }
  if (child.command.type === 'move') return child.command;
  return null;
}

/** Lookup judgment for a history move (prefers pathEnd). */
export function judgmentForMove(
  map: Map<string, MoveJudgmentInfo> | null,
  move: TreeHistoryMove,
): MoveJudgmentInfo | null {
  if (!map || map.size === 0) return null;
  const end = move.pathEnd ?? move.path;
  return map.get(pathKey(end)) ?? map.get(pathKey(move.path)) ?? null;
}
