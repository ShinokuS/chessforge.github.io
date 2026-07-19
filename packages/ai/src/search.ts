import {
  applyCommand,
  getLegalMoves,
  getPieceDefinition,
  isRoyalPiece,
  type GameCommand,
  type LegalMove,
  type MatchState,
} from '@chessforge/engine';
import { evaluate, pieceTacticalValue, isKingEnPrise } from './evaluate.js';
import { hashPosition } from './zobrist.js';

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_TIME_MS = 400;
const DEFAULT_NODE_LIMIT = 80_000;
const INF = 1_500_000;
const DEFAULT_TT_BITS = 16;

type Bound = 'exact' | 'lower' | 'upper';

type TtEntry = {
  key: number;
  depth: number;
  score: number;
  bound: Bound;
  moveKey: string | null;
};

type SearchContext = {
  nodes: number;
  nodeLimit: number;
  deadline: number;
  stopped: boolean;
  tt: TtEntry[];
  ttMask: number;
  killers: Array<[string | null, string | null]>;
  history: Map<string, number>;
};

export type ChooseOptions = {
  /** Fixed depth (skips iterative deepening if maxDepth not set higher). */
  depth?: number;
  /** Iterative deepening cap (default from depth or 4). */
  maxDepth?: number;
  /** Soft thinking time in ms (default 400). */
  timeMs?: number;
  /** Hard node budget (default 80k). */
  nodeLimit?: number;
  /** 0–10 skill; below 10 adds root-move noise (10 = full strength). */
  skill?: number;
  /** Transposition table size as power of two (default 16 → 65k). */
  ttBits?: number;
};

function moveKey(m: LegalMove): string {
  return `${m.from.x},${m.from.y}->${m.to.x},${m.to.y}:${m.abilityId ?? ''}:${m.captures ? 1 : 0}`;
}

function moveToCommand(m: LegalMove): GameCommand {
  return {
    type: 'move',
    from: { ...m.from },
    to: { ...m.to },
    ...(m.abilityId !== undefined ? { abilityId: m.abilityId } : {}),
  };
}

function shouldStop(ctx: SearchContext): boolean {
  if (ctx.stopped) return true;
  if (ctx.nodes >= ctx.nodeLimit) {
    ctx.stopped = true;
    return true;
  }
  if (ctx.nodes % 4096 === 0 && Date.now() >= ctx.deadline) {
    ctx.stopped = true;
    return true;
  }
  return false;
}

function isQuietTactical(m: LegalMove, state: MatchState): boolean {
  if (m.captures) return true;
  // Freeze-style "captures" already flagged; also prioritize cave warps / abilities.
  if (m.abilityId) return true;
  const piece = state.pieces.find(
    (p) => p.pos.x === m.from.x && p.pos.y === m.from.y,
  );
  if (!piece) return false;
  const def = getPieceDefinition(piece.defId);
  if (def.freezeInsteadOfCapture && m.captures) return true;
  return false;
}

function orderMoves(
  state: MatchState,
  moves: LegalMove[],
  ctx: SearchContext,
  ply: number,
  ttMove: string | null,
): LegalMove[] {
  const killers = ctx.killers[ply] ?? [null, null];
  return [...moves].sort((a, b) => scoreMove(state, b, ctx, killers, ttMove) - scoreMove(state, a, ctx, killers, ttMove));
}

function scoreMove(
  state: MatchState,
  m: LegalMove,
  ctx: SearchContext,
  killers: [string | null, string | null],
  ttMove: string | null,
): number {
  const key = moveKey(m);
  if (ttMove && key === ttMove) return 1_000_000;
  let s = 0;
  if (m.captures && m.targetPieceId) {
    const target = state.pieces.find((p) => p.id === m.targetPieceId);
    const victim = target ? pieceTacticalValue(target.defId) : 100;
    const attacker = state.pieces.find((p) => p.pos.x === m.from.x && p.pos.y === m.from.y);
    const atk = attacker ? pieceTacticalValue(attacker.defId) : 100;
    // MVV-LVA — king takes are absolute priority (game over).
    // MVV-LVA — royal takes are absolute priority (game over).
    const isKingCap = Boolean(target && isRoyalPiece(target));
    s += isKingCap ? 5_000_000 : 10_000 + victim * 16 - Math.floor(atk / 8);
    if (target && attacker && getPieceDefinition(attacker.defId).freezeInsteadOfCapture) {
      s += 800; // prefer freeze tempos
    }
  }
  if (m.abilityId) s += 600;
  if (key === killers[0]) s += 900;
  else if (key === killers[1]) s += 700;
  s += ctx.history.get(key) ?? 0;
  return s;
}

function storeKiller(ctx: SearchContext, ply: number, key: string): void {
  if (!ctx.killers[ply]) ctx.killers[ply] = [null, null];
  const slot = ctx.killers[ply]!;
  if (slot[0] === key) return;
  slot[1] = slot[0];
  slot[0] = key;
}

function ttProbe(ctx: SearchContext, key: number, depth: number, alpha: number, beta: number): {
  hit: boolean;
  score: number;
  moveKey: string | null;
} {
  const e = ctx.tt[key & ctx.ttMask];
  if (!e || e.key !== key) return { hit: false, score: 0, moveKey: null };
  if (e.depth < depth) return { hit: false, score: 0, moveKey: e.moveKey };
  if (e.bound === 'exact') return { hit: true, score: e.score, moveKey: e.moveKey };
  if (e.bound === 'lower' && e.score >= beta) return { hit: true, score: e.score, moveKey: e.moveKey };
  if (e.bound === 'upper' && e.score <= alpha) return { hit: true, score: e.score, moveKey: e.moveKey };
  return { hit: false, score: 0, moveKey: e.moveKey };
}

function ttStore(
  ctx: SearchContext,
  key: number,
  depth: number,
  score: number,
  bound: Bound,
  bestMove: string | null,
): void {
  // Avoid polluting TT with mate scores (STM-after-capture quirk + ply distance).
  if (Math.abs(score) > 500_000) return;
  const idx = key & ctx.ttMask;
  const prev = ctx.tt[idx];
  if (prev && prev.key === key && prev.depth > depth) return;
  ctx.tt[idx] = { key, depth, score, bound, moveKey: bestMove };
}

/**
 * Score from STM. After a winning capture, winner is still activePlayer
 * (no endTurn) — invert so the capturer's parent gets +mate via negamax.
 * Mate distance: prefer faster wins / slower losses so delaying tactics
 * (e.g. freeze for one tempo) beat immediate suicide at equal depth.
 */
function evalStm(state: MatchState, ply: number): number {
  if (state.phase === 'gameOver' && state.winner) {
    const losing = state.winner === state.activePlayer;
    const mate = losing ? -1_000_000 : 1_000_000;
    return mate + (losing ? ply : -ply);
  }
  return evaluate(state, state.activePlayer);
}

function quiesce(state: MatchState, alpha: number, beta: number, ctx: SearchContext, ply: number): number {
  ctx.nodes += 1;
  if (shouldStop(ctx) || state.phase === 'gameOver' || ply > 40) return evalStm(state, ply);

  const inCheck = isKingEnPrise(state, state.activePlayer);

  // When the king can be taken, stand-pat is meaningless — only try moves that
  // resolve the threat (otherwise the opponent takes the king in the next ply).
  if (inCheck) {
    const evasions = orderMoves(state, getLegalMoves(state), ctx, ply, null);
    if (evasions.length === 0) return evalStm(state, ply);
    let best = -INF;
    let any = false;
    for (const m of evasions) {
      if (shouldStop(ctx)) break;
      const result = applyCommand(state, moveToCommand(m));
      if (!result.ok) continue;
      // Skip moves that leave our king capturable — opponent would take it.
      if (
        result.state.phase === 'play' &&
        isKingEnPrise(result.state, state.activePlayer)
      ) {
        continue;
      }
      any = true;
      const score = -quiesce(result.state, -beta, -alpha, ctx, ply + 1);
      if (score > best) best = score;
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    // No safe move: king falls next — treat as lost.
    if (!any) return -1_000_000 + ply;
    return best === -INF ? evalStm(state, ply) : best;
  }

  const standPat = evalStm(state, ply);
  if (standPat >= beta) return standPat;
  if (standPat > alpha) alpha = standPat;

  const tactical = orderMoves(
    state,
    getLegalMoves(state).filter((m) => isQuietTactical(m, state)),
    ctx,
    ply,
    null,
  );

  for (const m of tactical) {
    if (shouldStop(ctx)) break;
    const result = applyCommand(state, moveToCommand(m));
    if (!result.ok) continue;
    const score = -quiesce(result.state, -beta, -alpha, ctx, ply + 1);
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(
  state: MatchState,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchContext,
  ply: number,
): number {
  ctx.nodes += 1;
  if (shouldStop(ctx) || state.phase === 'gameOver') {
    return evalStm(state, ply);
  }

  const inCheck = isKingEnPrise(state, state.activePlayer);
  // Check extension: don't drop into qsearch while the king is hanging.
  let d = depth;
  if (inCheck && d < 12) d += 1;

  if (d <= 0) {
    return quiesce(state, alpha, beta, ctx, ply);
  }

  const key = hashPosition(state);
  const probed = ttProbe(ctx, key, d, alpha, beta);
  if (probed.hit) return probed.score;

  // Null-move pruning — never when in check (king en prise).
  if (!inCheck && d >= 3 && ply > 0 && state.pieces.length >= 8 && beta < 500_000) {
    const nullRes = applyCommand(state, { type: 'endTurn' });
    if (nullRes.ok && nullRes.state.phase === 'play') {
      const R = d >= 6 ? 3 : 2;
      const nm = -negamax(nullRes.state, d - 1 - R, -beta, -beta + 1, ctx, ply + 1);
      if (nm >= beta) {
        if (!ctx.stopped) ttStore(ctx, key, d, nm, 'lower', null);
        return nm;
      }
    }
  }

  const moves = orderMoves(state, getLegalMoves(state), ctx, ply, probed.moveKey);
  if (moves.length === 0) {
    return evalStm(state, ply);
  }

  let best = -INF;
  let bestMove: string | null = null;
  let exactAlpha = alpha;
  let bound: Bound = 'upper';
  let moveIndex = 0;

  for (const m of moves) {
    if (shouldStop(ctx)) break;
    const result = applyCommand(state, moveToCommand(m));
    if (!result.ok) continue;

    const givesCheck =
      result.state.phase === 'play' && isKingEnPrise(result.state, result.state.activePlayer);

    let reduction = 0;
    if (
      !inCheck &&
      !givesCheck &&
      d >= 3 &&
      moveIndex >= 3 &&
      !m.captures &&
      !m.abilityId &&
      Math.abs(exactAlpha) < 400_000
    ) {
      reduction = moveIndex >= 8 && d >= 5 ? 2 : 1;
    }

    let score = -negamax(
      result.state,
      d - 1 - reduction,
      -beta,
      -exactAlpha,
      ctx,
      ply + 1,
    );
    if (reduction > 0 && score > exactAlpha && !ctx.stopped) {
      score = -negamax(result.state, d - 1, -beta, -exactAlpha, ctx, ply + 1);
    }

    moveIndex += 1;
    if (score > best) {
      best = score;
      bestMove = moveKey(m);
    }
    if (score > exactAlpha) {
      exactAlpha = score;
      bound = 'exact';
    }
    if (exactAlpha >= beta) {
      bound = 'lower';
      if (!m.captures) storeKiller(ctx, ply, moveKey(m));
      ctx.history.set(moveKey(m), (ctx.history.get(moveKey(m)) ?? 0) + ply * d);
      break;
    }
  }

  if (best === -INF) best = evalStm(state, ply);
  if (!ctx.stopped) ttStore(ctx, key, d, best, bound, bestMove);
  return best;
}

function createContext(timeMs: number, nodeLimit: number, ttBits = DEFAULT_TT_BITS): SearchContext {
  const bits = Math.max(12, Math.min(20, ttBits | 0));
  const size = 1 << bits;
  return {
    nodes: 0,
    nodeLimit,
    deadline: Date.now() + Math.max(30, timeMs),
    stopped: false,
    tt: new Array(size),
    ttMask: size - 1,
    killers: [],
    history: new Map(),
  };
}

/** Deterministic root noise for skill < 10 (same position → same blunder bias). */
function rootNoise(m: LegalMove, skill: number, depth: number): number {
  const soft = Math.max(0, 10 - Math.max(0, Math.min(10, skill)));
  if (soft <= 0) return 0;
  // Skill 0: huge noise → near-random; skill 9: small wobble.
  const amp = soft * soft * 18 + soft * 40;
  const h =
    ((m.from.x * 73856093) ^
      (m.from.y * 19349663) ^
      (m.to.x * 83492791) ^
      (m.to.y * 50331653) ^
      ((m.abilityId?.length ?? 0) * 2654435761) ^
      (depth * 97)) >>>
    0;
  const unit = (h % 2001) / 1000 - 1; // [-1, 1]
  return unit * amp;
}

function resolveSearchOpts(options: ChooseOptions): {
  maxDepth: number;
  timeMs: number;
  nodeLimit: number;
  skill: number;
  ttBits: number;
} {
  return {
    maxDepth: Math.max(1, Math.min(24, options.maxDepth ?? options.depth ?? DEFAULT_MAX_DEPTH)),
    timeMs: options.timeMs ?? DEFAULT_TIME_MS,
    nodeLimit: options.nodeLimit ?? DEFAULT_NODE_LIMIT,
    skill: Math.max(0, Math.min(10, options.skill ?? 10)),
    ttBits: options.ttBits ?? DEFAULT_TT_BITS,
  };
}

function pickRootMove(
  state: MatchState,
  rootMoves: LegalMove[],
  depth: number,
  ctx: SearchContext,
  skill: number,
  prevBest: LegalMove,
): { best: LegalMove; score: number; completed: boolean } {
  // Skill 0: ignore search, pick a pseudo-random legal move.
  if (skill <= 0) {
    const idx =
      (((state.turn * 2654435761) ^ (rootMoves.length * 97) ^ (depth * 13)) >>> 0) % rootMoves.length;
    return { best: rootMoves[idx]!, score: 0, completed: true };
  }

  const ordered = orderMoves(state, rootMoves, ctx, 0, moveKey(prevBest));
  let iterBest = ordered[0]!;
  let iterScore = -INF;
  let trueScore = -INF;
  let completed = true;

  for (const m of ordered) {
    if (shouldStop(ctx)) {
      completed = false;
      break;
    }
    const result = applyCommand(state, moveToCommand(m));
    if (!result.ok) continue;
    const score = -negamax(result.state, depth - 1, -INF, INF, ctx, 1);
    const adjusted = score + rootNoise(m, skill, depth);
    if (adjusted > iterScore) {
      iterScore = adjusted;
      iterBest = m;
      trueScore = score;
    }
  }

  return { best: iterBest, score: trueScore, completed };
}

/**
 * Score a subset of root moves at a fixed depth (for multi-worker parallel search).
 * Runs fully synchronously — call from a Web Worker so the UI thread stays free.
 * Returns `completed: false` if the budget ran out before every move was scored.
 */
export function scoreRootMoves(
  state: MatchState,
  moves: LegalMove[],
  depth: number,
  options: ChooseOptions = {},
): { results: Array<{ move: LegalMove; score: number }>; completed: boolean } {
  const { timeMs, nodeLimit, ttBits } = resolveSearchOpts({ ...options, skill: 10 });
  const ctx = createContext(timeMs, nodeLimit, ttBits);
  const d = Math.max(1, depth);
  const out: Array<{ move: LegalMove; score: number }> = [];
  const hardLimit = ctx.nodeLimit;
  const perMoveNodes = Math.max(1_200, Math.floor(nodeLimit / Math.max(1, moves.length)));

  for (const m of moves) {
    if (ctx.nodes >= hardLimit || Date.now() >= ctx.deadline) {
      return { results: out, completed: false };
    }
    ctx.stopped = false;
    const result = applyCommand(state, moveToCommand(m));
    if (!result.ok) continue;
    const nodesBefore = ctx.nodes;
    ctx.nodeLimit = Math.min(hardLimit, nodesBefore + perMoveNodes);
    const score = -negamax(result.state, d - 1, -INF, INF, ctx, 1);
    ctx.nodeLimit = hardLimit;
    // Soft per-move cap may set stopped — clear so remaining moves still get scored.
    if (ctx.nodes < hardLimit && Date.now() < ctx.deadline) ctx.stopped = false;
    out.push({ move: m, score });
  }
  return { results: out, completed: out.length >= moves.length };
}

/**
 * Pick the best command for the active player via iterative-deepening alphabeta.
 */
export function chooseCommand(state: MatchState, options: ChooseOptions = {}): GameCommand {
  const rootMoves = getLegalMoves(state);
  if (rootMoves.length === 0) {
    return { type: 'endTurn' };
  }

  const { maxDepth, timeMs, nodeLimit, skill, ttBits } = resolveSearchOpts(options);
  const ctx = createContext(timeMs, nodeLimit, ttBits);

  let bestMove = rootMoves[0]!;
  let bestScore = -INF;

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (shouldStop(ctx) && depth > 1) break;

    const { best, score, completed } = pickRootMove(state, rootMoves, depth, ctx, skill, bestMove);

    if (completed || depth === 1) {
      bestMove = best;
      bestScore = score;
    } else if (score > bestScore) {
      bestMove = best;
      bestScore = score;
    }
    if (bestScore > 500_000) break;
    if (shouldStop(ctx)) break;
    if (skill <= 0) break;
  }

  return moveToCommand(bestMove);
}

/** Async ID search that yields between depths so the UI stays responsive. */
export async function chooseCommandAsync(
  state: MatchState,
  options: ChooseOptions = {},
): Promise<GameCommand> {
  const rootMoves = getLegalMoves(state);
  if (rootMoves.length === 0) {
    return { type: 'endTurn' };
  }

  const { maxDepth, timeMs, nodeLimit, skill, ttBits } = resolveSearchOpts(options);
  const ctx = createContext(timeMs, nodeLimit, ttBits);

  let bestMove = rootMoves[0]!;
  let bestScore = -INF;

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (shouldStop(ctx) && depth > 1) break;

    const { best, score, completed } = pickRootMove(state, rootMoves, depth, ctx, skill, bestMove);

    if (completed || depth === 1) {
      bestMove = best;
      bestScore = score;
    } else if (score > bestScore) {
      bestMove = best;
      bestScore = score;
    }
    if (bestScore > 500_000) break;
    if (shouldStop(ctx)) break;
    if (skill <= 0) break;

    // Yield less often at high skill so deep iterations finish sooner.
    if (skill < 9 || depth % 2 === 0) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  return moveToCommand(bestMove);
}

export type SearchResult = {
  best: GameCommand;
  /** Centipawns from side-to-move perspective. */
  score: number;
  /** Centipawns from white's perspective (Lichess-style). */
  scoreWhite: number;
};

function runIterativeSearch(
  state: MatchState,
  options: ChooseOptions,
): { best: LegalMove; score: number } | null {
  const rootMoves = getLegalMoves(state);
  if (rootMoves.length === 0) return null;

  const { maxDepth, timeMs, nodeLimit, ttBits } = resolveSearchOpts({
    ...options,
    skill: 10,
  });
  const ctx = createContext(timeMs, nodeLimit, ttBits);

  let bestMove = rootMoves[0]!;
  let bestScore = -INF;

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (shouldStop(ctx) && depth > 1) break;
    const { best, score, completed } = pickRootMove(state, rootMoves, depth, ctx, 10, bestMove);
    if (completed || depth === 1) {
      bestMove = best;
      bestScore = score;
    } else if (score > bestScore) {
      bestMove = best;
      bestScore = score;
    }
    if (bestScore > 500_000) break;
    if (shouldStop(ctx)) break;
  }

  return { best: bestMove, score: bestScore };
}

/**
 * Full iterative search returning STM and white-centric scores.
 * Used by post-game analysis (search engine, not static eval).
 */
export function searchPosition(state: MatchState, options: ChooseOptions = {}): SearchResult {
  if (state.phase === 'gameOver') {
    const scoreWhite =
      state.winner === 'white' ? 1_000_000 : state.winner === 'black' ? -1_000_000 : 0;
    return {
      best: { type: 'endTurn' },
      score: state.activePlayer === 'white' ? scoreWhite : -scoreWhite,
      scoreWhite,
    };
  }

  const found = runIterativeSearch(state, options);
  if (!found) {
    const stand = evaluate(state, state.activePlayer);
    return {
      best: { type: 'endTurn' },
      score: stand,
      scoreWhite: state.activePlayer === 'white' ? stand : -stand,
    };
  }

  const scoreWhite = state.activePlayer === 'white' ? found.score : -found.score;
  return {
    best: moveToCommand(found.best),
    score: found.score,
    scoreWhite,
  };
}

/** White-centric search eval after applying `command`. */
export function searchScoreWhiteAfter(
  state: MatchState,
  command: GameCommand,
  options: ChooseOptions = {},
): number {
  const result = applyCommand(state, command);
  if (!result.ok) {
    return state.activePlayer === 'white' ? -INF : INF;
  }
  return searchPosition(result.state, options).scoreWhite;
}

/** STM search score for a specific root command. */
export function searchScoreCommand(
  state: MatchState,
  command: GameCommand,
  options: ChooseOptions = {},
): number {
  const { maxDepth, timeMs, nodeLimit, ttBits } = resolveSearchOpts({
    ...options,
    skill: 10,
  });
  const ctx = createContext(timeMs, nodeLimit, ttBits);
  const result = applyCommand(state, command);
  if (!result.ok) return -INF;
  if (result.state.phase === 'gameOver') {
    return -evalStm(result.state, 1);
  }
  return -negamax(result.state, Math.max(0, maxDepth - 1), -INF, INF, ctx, 1);
}
