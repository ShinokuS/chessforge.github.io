/**
 * Forgefish — Chessforge-native PVS / iterative deepening.
 * DPA-safe NMP, HP-SEE, selective quiescence, classic fast path when eligible.
 */
import {
  getLegalMoves,
  getPieceDefinition,
  type GameCommand,
  type LegalMove,
  type MatchState,
} from '@chessforge/engine';
import { canUseClassicFastPath } from '../../classic/detect.js';
import { searchClassic } from '../../classic/search.js';
import { isKingEnPriseFast } from '../../evaluate.js';
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
import { TranspositionTable, type Bound } from '../../search/tt.js';
import { analyzeDeferredPhysics, canNullMove } from './dpa.js';
import { evaluateFast, evaluateMid } from './eval.js';
import { hpSee, qsearchWorthy } from './hpSee.js';
import { applyCandidate, applyCandidateRoot } from './make.js';
import {
  candidates,
  orderCandidates,
  recordCutoff,
  type Candidate,
  type OrderingState,
} from './ordering.js';
import { forcedTacticalSet, shouldVerify } from './verify.js';

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
  fastAnalysis: boolean;
  evalCache: Map<number, number>;
  fastEvalCache: Map<number, number>;
  checkCache: Map<number, boolean>;
  moveCache: Map<number, LegalMove[]>;
  dpaCache: Map<number, ReturnType<typeof analyzeDeferredPhysics>>;
  softAbortIter: boolean;
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
    ordering: { killers: [], history: new Map(), counterMoves: new Map() },
    pv: [],
    fastAnalysis: options.fastAnalysis,
    evalCache: new Map(),
    fastEvalCache: new Map(),
    checkCache: new Map(),
    moveCache: new Map(),
    dpaCache: new Map(),
    softAbortIter: false,
    depthSliceMs: options.depthSliceMs,
  };
}

function stop(context: Context, reason: StopReason): boolean {
  context.stopped = true;
  context.stoppedBy ??= reason;
  return true;
}

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

function visit(context: Context, ply: number): void {
  context.nodes += 1;
  context.selDepth = Math.max(context.selDepth, ply);
}

function cachedDpa(state: MatchState, context: Context) {
  const key = hashPosition(state);
  const hit = context.dpaCache.get(key);
  if (hit) return hit;
  const dpa = analyzeDeferredPhysics(state);
  if (context.dpaCache.size < 200_000) context.dpaCache.set(key, dpa);
  return dpa;
}

function leafScore(state: MatchState, context: Context, fast: boolean): number {
  const terminal = terminalScore(state);
  if (terminal !== null) return terminal;
  const key = hashPosition(state);
  const cache = fast ? context.fastEvalCache : context.evalCache;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  // Live/fastAnalysis: Fast leaf for NPS. Full Mid when playing for accuracy.
  const useFast = fast || context.fastAnalysis;
  const score = useFast
    ? evaluateFast(state, state.activePlayer)
    : evaluateMid(state, state.activePlayer);
  if (cache.size < 400_000) cache.set(key, score);
  return score;
}

function kingEnPrise(state: MatchState, side: 'white' | 'black', context: Context): boolean {
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

function childScore(
  parentActive: MatchState['activePlayer'],
  child: MatchState,
  depth: number,
  alpha: number,
  beta: number,
  context: Context,
  ply: number,
  previousMove: string,
  allowNull: boolean,
  childInCheck: boolean | null,
): number {
  if (child.activePlayer === parentActive) {
    return pvs(child, depth, alpha, beta, context, ply, previousMove, allowNull, childInCheck);
  }
  return -pvs(child, depth, -beta, -alpha, context, ply, previousMove, allowNull, childInCheck);
}

function childQScore(
  parentActive: MatchState['activePlayer'],
  child: MatchState,
  alpha: number,
  beta: number,
  context: Context,
  ply: number,
  previousMove: string,
  childInCheck: boolean | null,
): number {
  if (child.activePlayer === parentActive) {
    return qsearch(child, alpha, beta, context, ply, previousMove, childInCheck);
  }
  return -qsearch(child, -beta, -alpha, context, ply, previousMove, childInCheck);
}

function lateMoveReduction(depth: number, moveNumber: number, fast: boolean): number {
  if (depth < 3 || moveNumber < 3) return 0;
  let r = Math.floor((Math.log(depth) * Math.log(moveNumber)) / (fast ? 1.35 : 2.1));
  if (fast && moveNumber >= 4) r += 1;
  if (fast && moveNumber >= 8) r += 1;
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

function tryNullMove(
  state: MatchState,
  depth: number,
  beta: number,
  evalScore: number,
  context: Context,
  ply: number,
): number | null {
  if (depth < 3 || evalScore < beta) return null;
  const dpa = cachedDpa(state, context);
  if (!canNullMove(state, dpa)) return null;

  let nonKing = 0;
  const stm = state.activePlayer;
  for (const p of state.pieces) {
    if (p.owner === stm && !isKingLike(p.defId)) {
      nonKing += 1;
      if (nonKing >= 2) break;
    }
  }
  if (nonKing < 2) return null;

  let R = 3 + Math.floor(depth / 4) + Math.min(2, Math.floor((evalScore - beta) / 200));
  if (context.fastAnalysis) R += 1;

  const applied = applyCandidate(state, {
    command: { type: 'endTurn' },
    key: 'endTurn',
    move: null,
    tactical: false,
  });
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
    null,
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
  const qLimit = context.fastAnalysis ? 5 : 10;
  if (hardStop(context) || ply >= qLimit) return leafScore(state, context, true);

  const inCheck = inCheckHint ?? kingEnPrise(state, state.activePlayer, context);
  const dpa = cachedDpa(state, context);
  let alpha = alphaInput;
  let best = -INF;
  let standPat = -INF;
  if (!inCheck) {
    standPat = leafScore(state, context, true);
    best = standPat;
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;
  }

  const all = candidates(
    state,
    cachedLegalMoves(state, context),
    dpa.endTurnMatters, // qsearch may pass to resolve spikes/wind
  );
  let selected: Candidate[] = [];
  if (inCheck) {
    selected = all;
  } else {
    for (const c of all) {
      if (!c.move) {
        if (c.tactical) selected.push(c);
        continue;
      }
      if (c.tactical && qsearchWorthy(state, c.move, standPat, alpha)) {
        selected.push(c);
      }
    }
  }
  const ordered = orderCandidates(state, selected, context.ordering, ply, null, previousMove);
  if (ordered.length === 0) return best === -INF ? leafScore(state, context, true) : best;

  for (const candidate of ordered) {
    if (hardStop(context)) break;
    if (!inCheck && candidate.move?.captures) {
      const see = hpSee(state, candidate.move);
      if (best + see + 80 <= alpha) continue;
    }

    const parentActive = state.activePlayer;
    const applied = applyCandidate(state, candidate);
    if (!applied.ok) continue;
    const child = applied.state;
    if (
      inCheck &&
      ply < 4 &&
      child.phase === 'play' &&
      kingEnPrise(child, parentActive, context)
    ) {
      continue;
    }
    const value = childQScore(
      parentActive,
      child,
      alpha,
      beta,
      context,
      ply + 1,
      candidate.key,
      null,
    );
    if (value > best) best = value;
    if (value >= beta) return value;
    if (value > alpha) alpha = value;
  }
  return best === -INF ? leafScore(state, context, true) : best;
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
  if (hardStop(context)) return leafScore(state, context, true);
  if (depth <= 0) {
    return qsearch(state, alphaInput, beta, context, ply, previousMove, inCheckHint);
  }

  const isPv = beta - alphaInput > 1;
  if (isPv) context.pv[ply] = [];
  const position = context.tt.identify(state);
  const probe = context.tt.probe(position, depth, alphaInput, beta, ply);
  if (probe.hit) return probe.score;

  const inCheck = inCheckHint ?? kingEnPrise(state, state.activePlayer, context);
  const searchDepth = depth;
  const evalScore = leafScore(state, context, true);
  const dpa = cachedDpa(state, context);
  let alpha = alphaInput;

  if (!isPv && !inCheck) {
    const futMul = context.fastAnalysis ? 1.05 : 1.2;
    if (
      searchDepth <= (context.fastAnalysis ? 7 : 6) &&
      !dpa.hasDeferredThreats &&
      evalScore - futilityMargin(searchDepth) * futMul >= beta &&
      Math.abs(evalScore) < MATE - 10_000
    ) {
      return evalScore;
    }
    if (
      searchDepth <= (context.fastAnalysis ? 4 : 3) &&
      evalScore + razorMargin(searchDepth) <= alpha
    ) {
      const razor = qsearch(state, alpha, beta, context, ply, previousMove);
      if (razor <= alpha) return razor;
    }
    const nullMargin = context.fastAnalysis ? 30 : 50;
    if (
      allowNull &&
      previousMove !== 'null' &&
      searchDepth >= 2 &&
      evalScore >= beta + nullMargin
    ) {
      const nullCut = tryNullMove(state, searchDepth, beta, evalScore, context, ply);
      if (nullCut !== null) return nullCut;
      if (context.stopped) return evalScore;
    }
  }

  const moveList = candidates(
    state,
    cachedLegalMoves(state, context),
    false, // endTurn only via extra-move / NMP / qsearch — not every PVS node
  );
  const ordered = orderCandidates(
    state,
    moveList,
    context.ordering,
    ply,
    probe.moveKey,
    previousMove,
  );
  if (ordered.length === 0) return evalScore;

  const originalAlpha = alphaInput;
  let best = -INF;
  let bestMove: string | null = null;
  let searched = 0;
  let quiets = 0;
  let verifiedFailHigh = false;

  for (const candidate of ordered) {
    if (hardStop(context)) break;
    const parentActive = state.activePlayer;
    const sameSidePly = Boolean(state.extraMovePieceId);
    const applied = applyCandidate(state, candidate);
    if (!applied.ok) continue;
    const child = applied.state;

    let check = false;
    let childCheckKnown = false;
    if (child.phase === 'play') {
      if (context.fastAnalysis) {
        if (inCheck) {
          check = kingEnPrise(child, child.activePlayer, context);
          childCheckKnown = true;
        }
      } else if (candidate.tactical || isPv) {
        check = kingEnPrise(child, child.activePlayer, context);
        childCheckKnown = true;
      }
    }
    const quiet =
      !candidate.tactical && !check && candidate.command.type !== 'endTurn';

    const lmpDepth = context.fastAnalysis ? 8 : 5;
    const lmpCap = context.fastAnalysis
      ? Math.max(1, Math.floor((searchDepth * searchDepth) / 3.2))
      : 2 + Math.floor((searchDepth * searchDepth + searchDepth) / 2);
    if (!isPv && !inCheck && quiet && searchDepth <= lmpDepth && quiets >= lmpCap) {
      continue;
    }

    if (
      !isPv &&
      !inCheck &&
      quiet &&
      !dpa.hasDeferredThreats &&
      searchDepth <= lmpDepth &&
      searched >= 1 &&
      evalScore + futilityMargin(searchDepth) * (context.fastAnalysis ? 0.7 : 1) <= alpha
    ) {
      continue;
    }

    if (
      !isPv &&
      context.fastAnalysis &&
      candidate.move &&
      (candidate.move.captures || candidate.move.push) &&
      searched >= 1 &&
      hpSee(state, candidate.move) < -40
    ) {
      continue;
    }

    let extension = 0;
    if (check && candidate.tactical && ply < 10 && searchDepth <= 6) extension = 1;
    const fullDepth = searchDepth - 1 + extension;

    let reduction = 0;
    if (
      searched >= (context.fastAnalysis ? 1 : 2) &&
      searchDepth >= 3 &&
      !inCheck &&
      quiet &&
      !check &&
      !sameSidePly &&
      child.activePlayer !== parentActive
    ) {
      reduction = lateMoveReduction(searchDepth, searched + 1, context.fastAnalysis);
      if (!isPv) reduction += context.fastAnalysis ? 2 : 1;
      if (isPv) reduction = Math.max(0, reduction - 1);
      reduction = Math.min(reduction, Math.max(0, fullDepth - 1));
    }

    const childHint = childCheckKnown ? check : null;
    let value: number;
    if (searched === 0) {
      value = childScore(
        parentActive,
        child,
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
      value = childScore(
        parentActive,
        child,
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
        value = childScore(
          parentActive,
          child,
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
        value = childScore(
          parentActive,
          child,
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
    if (
      !candidate.tactical &&
      candidate.command.type !== 'endTurn'
    ) {
      quiets += 1;
    }

    if (value > best) {
      best = value;
      bestMove = candidate.key;
      if (isPv) {
        context.pv[ply] = [candidate.command, ...(context.pv[ply + 1] ?? [])];
      }
    }
    if (value > alpha) alpha = value;
    if (alpha >= beta) {
      // Tactical verification on suspicious fail-high
      if (
        shouldVerify(isPv, searchDepth, value, beta, verifiedFailHigh) &&
        !context.fastAnalysis &&
        !context.stopped
      ) {
        verifiedFailHigh = true;
        const forced = forcedTacticalSet(state, ordered, 6);
        let verifyBest = value;
        for (const fc of forced) {
          if (fc.key === candidate.key) continue;
          const pa = state.activePlayer;
          const fa = applyCandidate(state, fc);
          if (!fa.ok) continue;
          const vs = childScore(
            pa,
            fa.state,
            Math.min(3, searchDepth - 1),
            beta - 1,
            beta,
            context,
            ply + 1,
            fc.key,
            false,
            null,
          );
          if (vs > verifyBest) verifyBest = vs;
        }
        if (verifyBest < beta) {
          // False fail-high — continue searching
          alpha = Math.max(originalAlpha, verifyBest);
          best = verifyBest;
          continue;
        }
        best = verifyBest;
      }
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
    const applied = applyCandidateRoot(state, candidate);
    if (!applied.ok) continue;
    legalTried += 1;
    context.pv[1] = [];

    const check =
      applied.state.phase === 'play' &&
      kingEnPrise(applied.state, applied.state.activePlayer, context);

    const reduction =
      searched >= 3 && depth >= 4 && !candidate.tactical && !check
        ? Math.min(2, lateMoveReduction(depth, searched + 1, context.fastAnalysis))
        : 0;

    let value: number;
    if (searched === 0) {
      value = childScore(
        state.activePlayer,
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
      value = childScore(
        state.activePlayer,
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
        value = childScore(
          state.activePlayer,
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
        value = childScore(
          state.activePlayer,
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
    if (context.stopped && searched > 1) break;

    const adjusted = value + rootNoise(candidate.command, skill, depth);
    if (value > searchScore) searchScore = value;
    if (adjusted > selectedAdjusted) {
      selectedAdjusted = adjusted;
      selectedScore = value;
      best = candidate;
      bestPv = [candidate.command, ...(context.pv[1] ?? [])];
    }
    if (value > alpha) alpha = value;
    if (alpha >= beta) {
      recordCutoff(context.ordering, candidate, 0, depth, null);
      break;
    }
  }

  // Soft-aborted depth slices still count as completed (Stockfish live contract).
  const completed =
    legalTried > 0 &&
    (!context.stopped ||
      (context.depthSliceMs > 0 && context.stoppedBy === 'softTime'));
  if (legalTried === 0) {
    return {
      best: {
        command: { type: 'endTurn' },
        key: 'endTurn',
        move: null,
        tactical: false,
      },
      score: leafScore(state, context, false),
      searchScore: leafScore(state, context, false),
      pv: [{ type: 'endTurn' }],
      completed: true,
    };
  }
  return {
    best,
    score: selectedScore,
    searchScore,
    pv: bestPv,
    completed,
  };
}

function iterative(
  state: MatchState,
  optionsInput: SearchOptions,
  onIteration?: (partial: FullSearchResult) => void,
): InternalResult {
  const options = resolveOptions(optionsInput);
  const context = createContext(options);
  const rootMoves = candidates(state, getLegalMoves(state), Boolean(state.extraMovePieceId));

  if (rootMoves.length === 0) {
    return {
      best: { type: 'endTurn' },
      score: leafScore(state, context, false),
      pv: [{ type: 'endTurn' }],
      depth: 0,
      context,
      stoppedBy: 'terminal',
    };
  }

  if (options.skill <= 0) {
    const idx =
      (((state.turn * 2654435761) ^ (rootMoves.length * 97)) >>> 0) % rootMoves.length;
    const pick = rootMoves[idx]!;
    return {
      best: pick.command,
      score: 0,
      pv: [pick.command],
      depth: 0,
      context,
      stoppedBy: 'depth',
    };
  }

  if (options.batch) {
    let best = rootMoves[0]!;
    let bestScore = -INF;
    for (const c of rootMoves) {
      const applied = applyCandidateRoot(state, c);
      if (!applied.ok) continue;
      const score = parentScore(
        state.activePlayer,
        applied.state,
        evaluateMid(applied.state, applied.state.activePlayer),
      );
      const adj = score + rootNoise(c.command, options.skill, 1);
      if (adj > bestScore) {
        bestScore = adj;
        best = c;
      }
    }
    return {
      best: best.command,
      score: bestScore,
      pv: [best.command],
      depth: 1,
      context,
      stoppedBy: 'depth',
    };
  }

  let best = rootMoves[0]!;
  let bestScore = -INF;
  let bestPv: GameCommand[] = [best.command];
  let completedDepth = 0;
  let previousBest: string | null = null;
  let accepted: Iteration | null = null;

  const unlimited = options.softTimeMs >= Number.MAX_SAFE_INTEGER / 4;
  const overallSoft = context.softDeadline;
  const startDepth = Math.min(options.maxDepth, Math.max(1, options.startDepth));
  const depthSliceMs = options.depthSliceMs;

  for (let depth = startDepth; depth <= options.maxDepth; depth += 1) {
    context.tt.nextGeneration();

    // Overall clock only — never the previous depth-slice deadline.
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

    // Soft-abort of prior slice must not kill the climb.
    if (context.stopped && context.stoppedBy === 'softTime') {
      context.stopped = false;
      context.stoppedBy = null;
    }

    let alpha = -INF;
    let beta = INF;
    let window = depthSliceMs > 0 ? 32 : 28;
    let iter: Iteration | null = null;
    for (let aspir = 0; aspir < 5; aspir += 1) {
      if (depth >= 4 && accepted) {
        alpha = Math.max(-INF, accepted.searchScore - window);
        beta = Math.min(INF, accepted.searchScore + window);
      }
      iter = rootSearch(state, rootMoves, depth, alpha, beta, context, options.skill, previousBest);
      if (context.stopped) break;
      if (window >= INF / 4) break;
      if (iter.searchScore <= alpha) {
        window = Math.min(INF, window * 2);
        alpha = -INF;
        continue;
      }
      if (iter.searchScore >= beta) {
        window = Math.min(INF, window * 2);
        beta = INF;
        continue;
      }
      break;
    }

    if (!iter) break;

    if (iter.completed) {
      accepted = iter;
      completedDepth = depth;
      best = iter.best;
      bestScore = iter.score;
      bestPv = iter.pv;
      previousBest = iter.best.key;
    } else if (!accepted) {
      accepted = iter;
      best = iter.best;
      bestScore = iter.score;
      bestPv = iter.pv;
      previousBest = iter.best.key;
      if (depth === startDepth) completedDepth = depth;
    } else if (unlimited || iter.searchScore > accepted.searchScore) {
      if (iter.searchScore > accepted.searchScore) {
        accepted = iter;
        best = iter.best;
        bestScore = iter.score;
        bestPv = iter.pv;
        previousBest = iter.best.key;
      }
    }

    if (accepted && onIteration) {
      const elapsedMs = Math.max(0, Date.now() - context.startedAt);
      onIteration({
        best: best.command,
        score: bestScore,
        scoreWhite: scoreWhite(state, bestScore),
        pv: bestPv,
        depth: completedDepth,
        selDepth: context.selDepth,
        nodes: context.nodes,
        nps: elapsedMs > 0 ? Math.round((context.nodes * 1000) / elapsedMs) : 0,
        elapsedMs,
        stoppedBy: context.stoppedBy ?? 'depth',
      });
    }

    if (Math.abs(iter.searchScore) >= MATE - 256) break;
    if (context.stoppedBy === 'nodes' || context.stoppedBy === 'hardTime') break;

    // Timed searches stop on incomplete deeper iter; live depth-slice keeps climbing.
    if (!iter.completed && depth > startDepth && depthSliceMs === 0) break;
  }

  const stoppedBy =
    context.stoppedBy ??
    (completedDepth >= options.maxDepth
      ? 'depth'
      : Date.now() >= overallSoft
        ? 'softTime'
        : 'depth');

  return {
    best: best.command,
    score: bestScore,
    pv: bestPv,
    depth: completedDepth,
    context,
    stoppedBy,
  };
}

export function chooseForgefish(state: MatchState, options: SearchOptions): GameCommand {
  if (canUseClassicFastPath(state)) return searchClassic(state, options).best;
  return iterative(state, options).best;
}

export async function chooseForgefishAsync(
  state: MatchState,
  options: SearchOptions,
): Promise<GameCommand> {
  if (canUseClassicFastPath(state)) {
    const result = searchClassic(state, options);
    await Promise.resolve();
    return result.best;
  }
  const result = iterative(state, options);
  await Promise.resolve();
  return result.best;
}

export function searchForgefish(
  state: MatchState,
  options: SearchOptions,
  onIteration?: (partial: FullSearchResult) => void,
): FullSearchResult {
  if (canUseClassicFastPath(state)) {
    return searchClassic(state, options, onIteration);
  }
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

export function scoreMovesForgefish(
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
    const list = candidates(state, [move], false);
    const c = list[0]!;
    const applied = applyCandidateRoot(state, c);
    if (!applied.ok) continue;
    const child = applied.state;
    const score = childScore(
      state.activePlayer,
      child,
      Math.max(0, depth - 1),
      -INF,
      INF,
      context,
      1,
      c.key,
      true,
      null,
    );
    results.push({ move, score });
  }
  return { results, completed: !context.stopped && results.length === moves.length };
}

export function scoreCommandForgefish(
  state: MatchState,
  command: GameCommand,
  depth: number,
  optionsInput: SearchOptions,
): { score: number; completed: boolean } {
  const options = resolveOptions(optionsInput, true);
  const context = createContext(options);
  const candidate: Candidate =
    command.type === 'endTurn'
      ? { command, key: 'endTurn', move: null, tactical: false }
      : {
          command,
          key: `${command.from.x},${command.from.y}->${command.to.x},${command.to.y}:${command.abilityId ?? ''}:0:${command.push ? 1 : 0}`,
          move: null,
          tactical: Boolean(command.abilityId || command.push),
        };

  // Prefer matching a legal move for make path
  if (command.type === 'move') {
    const legal = getLegalMoves(state).find(
      (m) =>
        m.from.x === command.from.x &&
        m.from.y === command.from.y &&
        m.to.x === command.to.x &&
        m.to.y === command.to.y &&
        (m.abilityId ?? '') === (command.abilityId ?? '') &&
        Boolean(m.push) === Boolean(command.push),
    );
    if (legal) {
      candidate.move = legal;
      candidate.tactical = Boolean(legal.captures || legal.abilityId || legal.push);
      candidate.key = `${legal.from.x},${legal.from.y}->${legal.to.x},${legal.to.y}:${legal.abilityId ?? ''}:${legal.captures ? 1 : 0}:${legal.push ? 1 : 0}`;
    }
  }

  const applied = applyCandidateRoot(state, candidate);
  if (!applied.ok) return { score: -INF, completed: true };
  const score = childScore(
    state.activePlayer,
    applied.state,
    Math.max(0, depth - 1),
    -INF,
    INF,
    context,
    1,
    candidate.key,
    true,
    null,
  );
  return { score, completed: !context.stopped };
}
