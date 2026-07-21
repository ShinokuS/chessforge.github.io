/**
 * Chessforge search — Stockfish-inspired PVS / iterative deepening.
 *
 * Soft time only between ID iterations; reported depth is always completed.
 * fastAnalysis = stronger LMR/LMP only (not fake depth). Client uses all threads.
 */
import {
  applyCommand,
  applyKnownMove,
  getLegalMoves,
  getPieceDefinition,
  type GameCommand,
  type LegalMove,
  type MatchState,
} from '@chessforge/engine';
import { canUseClassicFastPath } from '../../classic/detect.js';
import { searchClassic } from '../../classic/search.js';
import {
  evaluateSearch,
  evaluateSearchFast,
  isKingEnPriseFast,
} from '../../evaluate.js';
import { featureModBonus, ROLE_VALUE } from '../../heuristics.js';
import { hashPosition } from '../../zobrist.js';
import {
  INF,
  MATE,
  depthSliceBudget,
  parentScore,
  resolveOptions,
  rootNoise,
  scoreWhite,
  terminalScore,
  type FullSearchResult,
  type ResolvedOptions,
  type SearchOptions,
  type StopReason,
} from '../../search/model.js';
import {
  candidates,
  orderCandidates,
  recordCutoff,
  type Candidate,
  type OrderingState,
} from '../../search/ordering.js';
import { TranspositionTable, type Bound } from '../../search/tt.js';

type Context = {
  startedAt: number;
  softDeadline: number;
  hardDeadline: number;
  nodeLimit: number;
  nodes: number;
  selDepth: number;
  stopped: boolean;
  stoppedBy: StopReason | null;
  tt: TranspositionTable;
  ordering: OrderingState;
  pv: GameCommand[][];
  /** Milder extra LMR only — never changes root width or time model. */
  fastAnalysis: boolean;
  /** Leaf eval cache for this search (huge NPS win vs re-running threat maps). */
  evalCache: Map<number, number>;
  /** Fast (no-threat) eval cache for interior nodes. */
  fastEvalCache: Map<number, number>;
  /** King-en-prise cache (avoids a move-gen per node). */
  checkCache: Map<number, boolean>;
  /** Pseudo-legal move list cache (transpositions reuse movegen). */
  moveCache: Map<number, LegalMove[]>;
  /** When true, soft deadline aborts the current ID iteration mid-tree. */
  softAbortIter: boolean;
  /** Live depth ramp — ms budget per ID step (0 = full iter). */
  depthSliceMs: number;
};

type Iteration = {
  best: Candidate;
  score: number;
  searchScore: number;
  pv: GameCommand[];
  completed: boolean;
};

type InternalResult = {
  best: GameCommand;
  score: number;
  pv: GameCommand[];
  depth: number;
  context: Context;
  stoppedBy: StopReason;
};

function createContext(options: ResolvedOptions): Context {
  const startedAt = Date.now();
  return {
    startedAt,
    softDeadline: startedAt + options.softTimeMs,
    hardDeadline: startedAt + options.hardTimeMs,
    nodeLimit: options.nodeLimit,
    nodes: 0,
    selDepth: 0,
    stopped: false,
    stoppedBy: null,
    tt: new TranspositionTable(options.ttBits),
    ordering: {
      killers: [],
      history: new Map(),
      counterMoves: new Map(),
    },
    pv: [],
    fastAnalysis: options.fastAnalysis,
    evalCache: new Map(),
    fastEvalCache: new Map(),
    checkCache: new Map(),
    moveCache: new Map(),
    softAbortIter: false,
    depthSliceMs: options.depthSliceMs,
  };
}

function stop(context: Context, reason: StopReason): boolean {
  context.stopped = true;
  context.stoppedBy ??= reason;
  return true;
}

/**
 * Hard always aborts. Soft aborts the current ID iter when softAbortIter
 * (∞ live / fastAnalysis per-depth budget) so depth can climb every ~100–400ms.
 */
function hardStop(context: Context): boolean {
  if (context.stopped) return true;
  if (context.nodes >= context.nodeLimit) return stop(context, 'nodes');
  if ((context.nodes & 4095) === 0) {
    const now = Date.now();
    if (now >= context.hardDeadline) return stop(context, 'hardTime');
    if (context.softAbortIter && now >= context.softDeadline) {
      return stop(context, 'softTime');
    }
  }
  return false;
}

function softTimeExpired(context: Context): boolean {
  return Date.now() >= context.softDeadline;
}

function visit(context: Context, ply: number): void {
  context.nodes += 1;
  context.selDepth = Math.max(context.selDepth, ply);
}

/** Stand-pat / leaf eval — material only (captures found by qsearch). */
function staticScore(state: MatchState, context?: Context): number {
  const terminal = terminalScore(state);
  if (terminal !== null) return terminal;
  if (!context) return evaluateSearchFast(state, state.activePlayer);
  const key = hashPosition(state);
  const cached = context.evalCache.get(key);
  if (cached !== undefined) return cached;
  const score = evaluateSearchFast(state, state.activePlayer);
  if (context.evalCache.size < 400_000) context.evalCache.set(key, score);
  return score;
}

/** Interior pruning eval — same as leaf (both are evaluateSearchFast). */
function staticScoreFast(state: MatchState, context: Context): number {
  return staticScore(state, context);
}

function kingEnPrise(state: MatchState, side: 'white' | 'black', context: Context): boolean {
  // Mix side into the key; hashPosition already includes STM / pieces.
  const key = hashPosition(state) ^ (side === 'white' ? 0x13579bdf : 0x2468ace0);
  const cached = context.checkCache.get(key);
  if (cached !== undefined) return cached;
  const value = isKingEnPriseFast(state, side);
  if (context.checkCache.size < 200_000) context.checkCache.set(key, value);
  return value;
}

function cachedLegalMoves(state: MatchState, context: Context): LegalMove[] {
  const key = hashPosition(state);
  const hit = context.moveCache.get(key);
  if (hit) return hit;
  const moves = getLegalMoves(state);
  if (context.moveCache.size < 300_000) context.moveCache.set(key, moves);
  return moves;
}

function terminalAtPly(state: MatchState, ply: number): number | null {
  const score = terminalScore(state);
  if (score === null || score === 0) return score;
  return score > 0 ? score - ply : score + ply;
}

function searchChild(
  parent: MatchState,
  child: MatchState,
  depth: number,
  alpha: number,
  beta: number,
  context: Context,
  ply: number,
  previousMove: string,
  allowNull = true,
  childInCheck: boolean | null = null,
): number {
  if (child.activePlayer === parent.activePlayer) {
    return pvs(child, depth, alpha, beta, context, ply, previousMove, allowNull, childInCheck);
  }
  return -pvs(child, depth, -beta, -alpha, context, ply, previousMove, allowNull, childInCheck);
}

function qsearchChild(
  parent: MatchState,
  child: MatchState,
  alpha: number,
  beta: number,
  context: Context,
  ply: number,
  previousMove: string,
  childInCheck: boolean | null = null,
): number {
  if (child.activePlayer === parent.activePlayer) {
    return qsearch(child, alpha, beta, context, ply, previousMove, childInCheck);
  }
  return -qsearch(child, -beta, -alpha, context, ply, previousMove, childInCheck);
}

/** Stockfish-style LMR: log(depth) * log(moveNumber). */
function lateMoveReduction(depth: number, moveNumber: number, fast: boolean): number {
  if (depth < 3 || moveNumber < 3) return 0;
  let r = Math.floor((Math.log(depth) * Math.log(moveNumber)) / (fast ? 1.35 : 2.1));
  if (fast && moveNumber >= 4) r += 1;
  if (fast && moveNumber >= 8) r += 1;
  if (fast && moveNumber >= 14) r += 1;
  return Math.max(0, Math.min(depth - 1, r));
}

function futilityMargin(depth: number): number {
  return 80 + depth * 65;
}

function razorMargin(depth: number): number {
  return 160 + depth * 100;
}

function isKingLike(defId: string): boolean {
  return getPieceDefinition(defId).baseRole === 'king';
}

function victimDeltaGain(state: MatchState, targetPieceId: string | undefined): number {
  if (!targetPieceId) return 400;
  const victim = state.pieces.find((p) => p.id === targetPieceId);
  if (!victim) return 400;
  try {
    const def = getPieceDefinition(victim.defId);
    if (def.baseRole === 'king') return 900;
    const full = ROLE_VALUE[def.baseRole] + featureModBonus(def);
    const hpFrac = def.maxHp > 0 ? Math.min(1, 0.4 + 0.6 * (victim.hp / def.maxHp)) : 1;
    return Math.min(900, Math.max(120, full * hpFrac));
  } catch {
    return 400;
  }
}

function applyCandidate(state: MatchState, candidate: Candidate) {
  if (candidate.move) {
    return applyKnownMove(state, candidate.move);
  }
  return applyCommand(state, candidate.command);
}

/**
 * Null-move pruning (SF NMP): pass the turn, reduced-depth search.
 * Skip when in check / low material / extra-move mid-turn.
 */
function tryNullMove(
  state: MatchState,
  depth: number,
  beta: number,
  evalScore: number,
  context: Context,
  ply: number,
): number | null {
  if (depth < 3 || evalScore < beta || state.extraMovePieceId) return null;
  let nonKing = 0;
  const stm = state.activePlayer;
  const pieces = state.pieces;
  for (let i = 0; i < pieces.length; i += 1) {
    const p = pieces[i]!;
    if (p.owner === stm && !isKingLike(p.defId)) {
      nonKing += 1;
      if (nonKing >= 2) break;
    }
  }
  if (nonKing < 2) return null;

  let R = 3 + Math.floor(depth / 4) + Math.min(2, Math.floor((evalScore - beta) / 200));
  if (context.fastAnalysis) R += 1;
  const applied = applyCommand(state, { type: 'endTurn' });
  if (!applied.ok) return null;

  const nullScore = -pvs(
    applied.state,
    Math.max(0, depth - 1 - R),
    -beta,
    -beta + 1,
    context,
    ply + 1,
    'null',
    false,
  );
  if (nullScore >= beta) {
    return nullScore >= MATE - 10_000 ? beta : nullScore;
  }
  return null;
}

function qsearch(
  state: MatchState,
  alphaInput: number,
  beta: number,
  context: Context,
  ply: number,
  previousMove: string | null,
  inCheckHint: boolean | null = null,
): number {
  visit(context, ply);
  const terminal = terminalAtPly(state, ply);
  if (terminal !== null) return terminal;
  const qLimit = context.fastAnalysis ? 8 : 12;
  if (hardStop(context) || ply >= qLimit) return staticScore(state, context);

  const inCheck =
    inCheckHint ?? kingEnPrise(state, state.activePlayer, context);
  let alpha = alphaInput;
  let best = -INF;
  if (!inCheck) {
    const standPat = staticScore(state, context);
    best = standPat;
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;
  }

  const all = candidates(state, cachedLegalMoves(state, context));
  // Avoid .filter() alloc: order only tactical when not in check.
  let selected = all;
  if (!inCheck) {
    selected = [];
    for (let i = 0; i < all.length; i += 1) {
      if (all[i]!.tactical) selected.push(all[i]!);
    }
  }
  const ordered = orderCandidates(state, selected, context.ordering, ply, null, previousMove);
  if (ordered.length === 0) return best === -INF ? staticScore(state, context) : best;

  for (const candidate of ordered) {
    if (hardStop(context)) break;
    if (!inCheck && candidate.move?.captures) {
      if (best + victimDeltaGain(state, candidate.move.targetPieceId) + 80 <= alpha) {
        continue;
      }
    }
    const applied = applyCandidate(state, candidate);
    if (!applied.ok) continue;
    // Skip illegal evasions only near the root of qsearch (expensive check).
    if (
      inCheck &&
      ply < 4 &&
      applied.state.phase === 'play' &&
      kingEnPrise(applied.state, state.activePlayer, context)
    ) {
      continue;
    }
    const value = qsearchChild(
      state,
      applied.state,
      alpha,
      beta,
      context,
      ply + 1,
      candidate.key,
    );
    if (value > best) best = value;
    if (value >= beta) return value;
    if (value > alpha) alpha = value;
  }
  return best === -INF ? staticScore(state, context) : best;
}

function pvs(
  state: MatchState,
  depth: number,
  alphaInput: number,
  beta: number,
  context: Context,
  ply: number,
  previousMove: string | null,
  allowNull = true,
  inCheckHint: boolean | null = null,
): number {
  visit(context, ply);
  const terminal = terminalAtPly(state, ply);
  if (terminal !== null) return terminal;
  if (hardStop(context)) return staticScore(state, context);
  if (depth <= 0) {
    return qsearch(state, alphaInput, beta, context, ply, previousMove, inCheckHint);
  }

  const isPv = beta - alphaInput > 1;
  if (isPv) context.pv[ply] = [];
  const position = context.tt.identify(state);
  const probe = context.tt.probe(position, depth, alphaInput, beta, ply);
  if (probe.hit) return probe.score;

  const inCheck =
    inCheckHint ?? kingEnPrise(state, state.activePlayer, context);
  // Do NOT bump depth for every in-check node — with a heavy eval that
  // explodes the tree and leaves timed analysis stuck at depth 1–2.
  // Stockfish can afford check extensions because NNUE is tiny; we extend
  // only when *giving* check (below), and skip pruning while in check.
  const searchDepth = depth;

  const evalScore = staticScoreFast(state, context);
  let alpha = alphaInput;

  // Forward pruning — never while in check (SF).
  if (!isPv && !inCheck) {
    const futMul = context.fastAnalysis ? 1.05 : 1.2;
    if (
      searchDepth <= (context.fastAnalysis ? 7 : 6) &&
      evalScore - futilityMargin(searchDepth) * futMul >= beta &&
      Math.abs(evalScore) < MATE - 10_000
    ) {
      return evalScore;
    }
    if (searchDepth <= (context.fastAnalysis ? 4 : 3) && evalScore + razorMargin(searchDepth) <= alpha) {
      const razor = qsearch(state, alpha, beta, context, ply, previousMove);
      if (razor <= alpha) return razor;
    }
    const nullMargin = context.fastAnalysis ? 30 : 50;
    if (allowNull && previousMove !== 'null' && searchDepth >= 2 && evalScore >= beta + nullMargin) {
      const nullCut = tryNullMove(state, searchDepth, beta, evalScore, context, ply);
      if (nullCut !== null) return nullCut;
      if (context.stopped) return evalScore;
    }
  }

  let moveList = candidates(state, cachedLegalMoves(state, context));
  const ttMove = probe.moveKey;

  const ordered = orderCandidates(
    state,
    moveList,
    context.ordering,
    ply,
    ttMove,
    previousMove,
  );
  if (ordered.length === 0) return evalScore;

  const originalAlpha = alphaInput;
  let best = -INF;
  let bestMove: string | null = null;
  let searched = 0;
  let quiets = 0;

  for (const candidate of ordered) {
    if (hardStop(context)) break;
    const applied = applyCandidate(state, candidate);
    if (!applied.ok) continue;

    // Check probe: skip in fastAnalysis except when evading check (move-gen is costly).
    let check = false;
    let childCheckKnown = false;
    if (applied.state.phase === 'play') {
      if (context.fastAnalysis) {
        if (inCheck) {
          check = kingEnPrise(applied.state, applied.state.activePlayer, context);
          childCheckKnown = true;
        }
      } else if (candidate.tactical || isPv) {
        check = kingEnPrise(applied.state, applied.state.activePlayer, context);
        childCheckKnown = true;
      }
    }
    const quiet =
      !candidate.tactical &&
      !check &&
      candidate.command.type !== 'endTurn';

    // Late move pruning (non-PV, not in check).
    const lmpDepth = context.fastAnalysis ? 7 : 5;
    if (
      !isPv &&
      !inCheck &&
      quiet &&
      searchDepth <= lmpDepth &&
      quiets >=
        (context.fastAnalysis
          ? Math.max(1, Math.floor((searchDepth * searchDepth) / 2.5))
          : 2 + Math.floor((searchDepth * searchDepth + searchDepth) / 2))
    ) {
      continue;
    }

    if (
      !isPv &&
      !inCheck &&
      quiet &&
      searchDepth <= lmpDepth &&
      searched >= 1 &&
      evalScore + futilityMargin(searchDepth) * (context.fastAnalysis ? 0.85 : 1) <= alpha
    ) {
      continue;
    }

    // Check extension only for tactical checks.
    let extension = 0;
    if (check && candidate.tactical && ply < 10 && searchDepth <= 6) extension = 1;
    const fullDepth = searchDepth - 1 + extension;

    // LMR: never reduce checks, captures, PV first moves, or check evasions.
    let reduction = 0;
    if (
      searched >= 2 &&
      searchDepth >= 3 &&
      !inCheck &&
      quiet &&
      !check &&
      applied.state.activePlayer !== state.activePlayer
    ) {
      reduction = lateMoveReduction(searchDepth, searched + 1, context.fastAnalysis);
      if (!isPv) reduction += 1;
      if (isPv) reduction = Math.max(0, reduction - 1);
      reduction = Math.min(reduction, Math.max(0, fullDepth - 1));
    }

    let value: number;
    const childHint = childCheckKnown ? check : null;
    if (searched === 0) {
      value = searchChild(
        state,
        applied.state,
        fullDepth,
        alpha,
        beta,
        context,
        ply + 1,
        candidate.key,
        true,
        childHint,
      );
    } else {
      value = searchChild(
        state,
        applied.state,
        Math.max(0, fullDepth - reduction),
        alpha,
        alpha + 1,
        context,
        ply + 1,
        candidate.key,
        true,
        childHint,
      );
      if (reduction > 0 && value > alpha && !context.stopped) {
        value = searchChild(
          state,
          applied.state,
          fullDepth,
          alpha,
          alpha + 1,
          context,
          ply + 1,
          candidate.key,
          true,
          childHint,
        );
      }
      if (value > alpha && value < beta && !context.stopped) {
        value = searchChild(
          state,
          applied.state,
          fullDepth,
          alpha,
          beta,
          context,
          ply + 1,
          candidate.key,
          true,
          childHint,
        );
      }
    }
    searched += 1;
    if (quiet) quiets += 1;

    if (value > best) {
      best = value;
      bestMove = candidate.key;
      if (isPv) {
        context.pv[ply] = [candidate.command, ...(context.pv[ply + 1] ?? [])];
      }
    }
    if (value > alpha) alpha = value;
    if (alpha >= beta) {
      recordCutoff(context.ordering, candidate, ply, searchDepth, previousMove);
      break;
    }
  }

  if (best === -INF) return evalScore;
  if (!context.stopped) {
    const bound: Bound =
      best <= originalAlpha ? 'upper' : best >= beta ? 'lower' : 'exact';
    context.tt.store(position, searchDepth, best, bound, bestMove, ply);
  }
  return best;
}

function rootSearch(
  state: MatchState,
  root: Candidate[],
  depth: number,
  alphaInput: number,
  beta: number,
  context: Context,
  skill: number,
  previousBest: string | null,
): Iteration {
  // Always search the full ordered root — Stockfish never drops to 2–3 moves.
  const ordered = orderCandidates(state, root, context.ordering, 0, previousBest, null);
  let alpha = alphaInput;
  let searchScore = -INF;
  let selectedScore = -INF;
  let selectedAdjusted = -INF;
  let best = ordered[0]!;
  let bestPv: GameCommand[] = [best.command];
  let searched = 0;
  let legalTried = 0;

  for (const candidate of ordered) {
    if (hardStop(context)) break;
    const applied = applyCandidate(state, candidate);
    if (!applied.ok) continue;
    legalTried += 1;
    context.pv[1] = [];

    const check =
      applied.state.phase === 'play' &&
      kingEnPrise(applied.state, applied.state.activePlayer, context);

    let value: number;
    // Root LMR only for late quiet non-checking moves.
    const reduction =
      searched >= 3 && depth >= 4 && !candidate.tactical && !check
        ? Math.min(2, lateMoveReduction(depth, searched + 1, context.fastAnalysis))
        : 0;

    if (searched === 0) {
      value = searchChild(
        state,
        applied.state,
        depth - 1,
        alpha,
        beta,
        context,
        1,
        candidate.key,
        true,
        check,
      );
    } else {
      value = searchChild(
        state,
        applied.state,
        Math.max(0, depth - 1 - reduction),
        alpha,
        alpha + 1,
        context,
        1,
        candidate.key,
        true,
        check,
      );
      if (reduction > 0 && value > alpha && !context.stopped) {
        value = searchChild(
          state,
          applied.state,
          depth - 1,
          alpha,
          alpha + 1,
          context,
          1,
          candidate.key,
          true,
          check,
        );
      }
      if (value > alpha && value < beta && !context.stopped) {
        value = searchChild(
          state,
          applied.state,
          depth - 1,
          alpha,
          beta,
          context,
          1,
          candidate.key,
          true,
          check,
        );
      }
    }
    searched += 1;
    if (value > searchScore) searchScore = value;
    if (value > alpha) alpha = value;

    const adjusted = value + rootNoise(candidate.command, skill, depth);
    if (adjusted > selectedAdjusted) {
      selectedAdjusted = adjusted;
      selectedScore = value;
      best = candidate;
      bestPv = [candidate.command, ...(context.pv[1] ?? [])];
    }
    if (alpha >= beta) break;
  }

  return {
    best,
    score: selectedScore === -INF ? staticScore(state, context) : selectedScore,
    searchScore: searchScore === -INF ? staticScore(state, context) : searchScore,
    pv: bestPv,
    // Complete if we searched ≥1 move; soft-aborted fastAnalysis iters still count.
    completed:
      legalTried > 0 &&
      (!context.stopped ||
        (context.depthSliceMs > 0 && context.stoppedBy === 'softTime')),
  };
}

function staticBatch(state: MatchState, options: ResolvedOptions): InternalResult {
  const context = createContext(options);
  const root = candidates(state, cachedLegalMoves(state, context));
  if (root.length === 0) {
    const score = staticScore(state, context);
    return {
      best: { type: 'endTurn' },
      score,
      pv: [],
      depth: 0,
      context,
      stoppedBy: 'terminal',
    };
  }
  let best = root[0]!;
  let bestScore = -INF;
  let bestTrueScore = -INF;
  for (const candidate of root) {
    const result = applyCandidate(state, candidate);
    if (!result.ok) continue;
    const value = evaluateSearch(result.state, state.activePlayer);
    const adjusted = value + rootNoise(candidate.command, options.skill, 1);
    if (adjusted > bestScore) {
      bestScore = adjusted;
      bestTrueScore = value;
      best = candidate;
    }
  }
  return {
    best: best.command,
    score: bestTrueScore,
    pv: [best.command],
    depth: 1,
    context,
    stoppedBy: 'depth',
  };
}

/**
 * Iterative deepening — soft time only BETWEEN completed iterations.
 * Reported depth = last fully completed ID iteration (never inflated).
 * ∞ climbs as each depth finishes; timed stops when the soft budget is gone.
 */
function iterative(
  state: MatchState,
  optionsInput: SearchOptions,
  onIteration?: (partial: FullSearchResult) => void,
): InternalResult {
  const options = resolveOptions(optionsInput, (optionsInput.skill ?? 10) >= 10);
  if (options.batch) return staticBatch(state, options);
  const context = createContext(options);
  const root = candidates(state, cachedLegalMoves(state, context));
  if (root.length === 0) {
    const score = staticScore(state, context);
    return {
      best: { type: 'endTurn' },
      score,
      pv: [],
      depth: 0,
      context,
      stoppedBy: terminalScore(state) !== null ? 'terminal' : 'depth',
    };
  }

  let accepted: Iteration | null = null;
  let completedDepth = 0;
  const unlimited = options.softTimeMs >= Number.MAX_SAFE_INTEGER / 4;
  const overallSoft = context.softDeadline;
  const startDepth = Math.min(options.maxDepth, options.startDepth);
  const depthSliceMs = options.depthSliceMs;

  for (let depth = startDepth; depth <= options.maxDepth; depth += 1) {
    context.tt.nextGeneration();

    if (depth > startDepth && Date.now() >= overallSoft) {
      context.stoppedBy ??= 'softTime';
      break;
    }

    if (depthSliceMs > 0 && unlimited) {
      context.softAbortIter = true;
      context.softDeadline =
        Date.now() + depthSliceBudget(depth, options.maxDepth, depthSliceMs);
    } else {
      context.softDeadline = overallSoft;
      context.softAbortIter = false;
    }

    if (context.stopped && context.stoppedBy === 'softTime') {
      context.stopped = false;
      context.stoppedBy = null;
    }

    const aspWindow = depthSliceMs > 0 ? 32 : 28;
    let delta = depth >= 4 && accepted ? aspWindow : INF;
    let alpha = accepted && delta < INF ? Math.max(-INF, accepted.searchScore - delta) : -INF;
    let beta = accepted && delta < INF ? Math.min(INF, accepted.searchScore + delta) : INF;
    let current: Iteration | null = null;
    let failedHigh = 0;
    let aspTries = 0;

    for (;;) {
      aspTries += 1;
      if (aspTries > 5) break;

      current = rootSearch(
        state,
        root,
        Math.max(1, depth - failedHigh),
        alpha,
        beta,
        context,
        options.skill,
        accepted?.best.key ?? null,
      );

      if (context.stopped) break;
      if (delta >= INF) break;

      if (current.searchScore <= alpha) {
        beta = Math.floor((alpha + beta) / 2);
        alpha = Math.max(-INF, current.searchScore - delta);
        delta = Math.min(INF, delta + Math.floor(delta / 3) + 8);
        failedHigh = 0;
        continue;
      }
      if (current.searchScore >= beta) {
        beta = Math.min(INF, current.searchScore + delta);
        delta = Math.min(INF, delta + Math.floor(delta / 3) + 8);
        failedHigh += 1;
        continue;
      }
      break;
    }

    if (!current) break;

    if (current.completed) {
      accepted = current;
      completedDepth = depth;
    } else if (!accepted) {
      accepted = current;
    } else if (unlimited) {
      if (current.searchScore > accepted.searchScore) accepted = current;
    } else if (current.searchScore > accepted.searchScore) {
      accepted = current;
    }

    if (accepted && onIteration) {
      const elapsedMs = Math.max(0, Date.now() - context.startedAt);
      onIteration({
        best: accepted.best.command,
        score: accepted.score,
        scoreWhite: scoreWhite(state, accepted.score),
        pv: accepted.pv,
        depth: completedDepth,
        selDepth: context.selDepth,
        nodes: context.nodes,
        nps: elapsedMs > 0 ? Math.round((context.nodes * 1000) / elapsedMs) : 0,
        elapsedMs,
        stoppedBy: context.stoppedBy ?? 'depth',
      });
    }

    if (Math.abs(current.searchScore) >= MATE - 256) break;
    if (context.stoppedBy === 'nodes' || context.stoppedBy === 'hardTime') break;

    // Timed non-fast: stop on incomplete deeper iter. Fast live keeps climbing.
    if (!current.completed && depth > startDepth && options.depthSliceMs === 0) break;
  }

  const result = accepted;
  if (!result) {
    const q = qsearch(state, -INF, INF, context, 0, null);
    return {
      best: root[0]?.command ?? { type: 'endTurn' },
      score: q,
      pv: root[0] ? [root[0].command] : [],
      depth: 0,
      context,
      stoppedBy: context.stoppedBy ?? 'softTime',
    };
  }

  const stoppedBy =
    context.stoppedBy ??
    (completedDepth >= options.maxDepth
      ? 'depth'
      : Date.now() >= overallSoft
        ? 'softTime'
        : 'depth');

  return {
    best: result.best.command,
    score: result.score,
    pv: result.pv,
    depth: completedDepth,
    context,
    stoppedBy,
  };
}

export function chooseStockfish(state: MatchState, options: SearchOptions): GameCommand {
  if (canUseClassicFastPath(state)) return searchClassic(state, options).best;
  return iterative(state, options).best;
}

export async function chooseStockfishAsync(
  state: MatchState,
  options: SearchOptions,
): Promise<GameCommand> {
  const result = canUseClassicFastPath(state)
    ? searchClassic(state, options)
    : iterative(state, options);
  await Promise.resolve();
  return result.best;
}

export function searchStockfish(
  state: MatchState,
  options: SearchOptions,
  onIteration?: (partial: FullSearchResult) => void,
): FullSearchResult {
  const terminal = terminalScore(state);
  if (terminal !== null) {
    return {
      best: { type: 'endTurn' },
      score: terminal,
      scoreWhite: scoreWhite(state, terminal),
      pv: [],
      depth: 0,
      selDepth: 0,
      nodes: 0,
      nps: 0,
      elapsedMs: 0,
      stoppedBy: 'terminal',
    };
  }
  if (canUseClassicFastPath(state)) {
    return searchClassic(state, options, onIteration);
  }
  const result = iterative(state, options, onIteration);
  const elapsedMs = Math.max(0, Date.now() - result.context.startedAt);
  return {
    best: result.best,
    score: result.score,
    scoreWhite: scoreWhite(state, result.score),
    pv: result.pv,
    depth: result.depth,
    selDepth: result.context.selDepth,
    nodes: result.context.nodes,
    nps: elapsedMs > 0 ? Math.round((result.context.nodes * 1000) / elapsedMs) : 0,
    elapsedMs,
    stoppedBy: result.stoppedBy,
  };
}

export function scoreMovesStockfish(
  state: MatchState,
  moves: LegalMove[],
  depth: number,
  optionsInput: SearchOptions,
): { results: Array<{ move: LegalMove; score: number }>; completed: boolean } {
  const options = resolveOptions(optionsInput, true);
  const context = createContext(options);
  const results: Array<{ move: LegalMove; score: number }> = [];
  for (const move of moves) {
    if (hardStop(context)) break;
    const candidate = candidates(state, [move])[0]!;
    const applied = applyCandidate(state, candidate);
    if (!applied.ok) continue;
    const child = pvs(
      applied.state,
      Math.max(0, depth - 1),
      -INF,
      INF,
      context,
      1,
      candidate.key,
    );
    results.push({
      move,
      score: parentScore(state.activePlayer, applied.state, child),
    });
  }
  return { results, completed: !context.stopped && results.length === moves.length };
}

export function scoreCommandStockfish(
  state: MatchState,
  command: GameCommand,
  depth: number,
  optionsInput: SearchOptions,
): { score: number; completed: boolean } {
  const options = resolveOptions(optionsInput, true);
  const context = createContext(options);
  const applied = applyCommand(state, command);
  if (!applied.ok) return { score: -INF, completed: true };
  const key =
    command.type === 'endTurn'
      ? 'endTurn'
      : `${command.from.x},${command.from.y}->${command.to.x},${command.to.y}`;
  const child = pvs(
    applied.state,
    Math.max(0, depth - 1),
    -INF,
    INF,
    context,
    1,
    key,
  );
  return {
    score: parentScore(state.activePlayer, applied.state, child),
    completed: !context.stopped,
  };
}
