import type { GameCommand, MatchState } from '@chessforge/engine';
import {
  ClassicBoard,
  moveFrom,
  moveTo,
  pieceValue,
} from './board.js';
import {
  INF,
  MATE,
  resolveOptions,
  scoreWhite,
  type FullSearchResult,
  type SearchOptions,
  type StopReason,
} from '../search/model.js';

type TtEntry = {
  key: number;
  depth: number;
  score: number;
  flag: 0 | 1 | 2; // exact, lower, upper
  move: number;
};

function hashBoard(b: ClassicBoard): number {
  // Fast FNV-ish over mailbox + STM
  let h = b.whiteToMove ? 0x9e3779b9 : 0x85ebca6b;
  const board = b.board;
  for (let i = 0; i < 64; i += 1) {
    const p = board[i]!;
    if (!p) continue;
    h ^= Math.imul(p + i * 97, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  }
  h ^= b.castleRights * 0x27d4eb2d;
  return h >>> 0;
}

class ClassicSearch {
  board: ClassicBoard;
  softDeadline = 0;
  hardDeadline = 0;
  nodeLimit = 0;
  nodes = 0;
  stopped = false;
  stoppedBy: StopReason | null = null;
  selDepth = 0;
  fast = false;
  tt: TtEntry[];
  ttMask: number;
  killers: Array<[number, number]> = [];
  history = new Int32Array(64 * 64);
  moveBuf: number[] = new Array(256);
  scoreBuf: number[] = new Array(256);
  pv: number[][] = [];

  constructor(board: ClassicBoard, ttBits: number) {
    this.board = board;
    const size = 1 << Math.max(12, Math.min(20, ttBits));
    this.tt = new Array(size);
    this.ttMask = size - 1;
  }

  private stop(reason: StopReason): boolean {
    this.stopped = true;
    this.stoppedBy ??= reason;
    return true;
  }

  private hardStop(): boolean {
    if (this.stopped) return true;
    if (this.nodes >= this.nodeLimit) return this.stop('nodes');
    if ((this.nodes & 4095) === 0) {
      if (Date.now() >= this.hardDeadline) return this.stop('hardTime');
    }
    return false;
  }

  private order(moves: number[], count: number, ttMove: number, ply: number): void {
    const killers = this.killers[ply] ?? [0, 0];
    for (let i = 0; i < count; i += 1) {
      const m = moves[i]!;
      let s = 0;
      if (m === ttMove) s = 1_000_000;
      else {
        const to = moveTo(m);
        const cap = this.board.board[to]!;
        if (cap) s = 10_000 + pieceValue(cap) * 10 - pieceValue(this.board.board[moveFrom(m)]!);
        else if (m === killers[0]) s = 9_000;
        else if (m === killers[1]) s = 8_000;
        else s = this.history[(moveFrom(m) << 6) | to] ?? 0;
      }
      this.scoreBuf[i] = s;
    }
    // Insertion sort — small move lists
    for (let i = 1; i < count; i += 1) {
      const m = moves[i]!;
      const sc = this.scoreBuf[i]!;
      let j = i - 1;
      while (j >= 0 && this.scoreBuf[j]! < sc) {
        moves[j + 1] = moves[j]!;
        this.scoreBuf[j + 1] = this.scoreBuf[j]!;
        j -= 1;
      }
      moves[j + 1] = m;
      this.scoreBuf[j + 1] = sc;
    }
  }

  private qsearch(alpha: number, beta: number, ply: number): number {
    this.nodes += 1;
    this.selDepth = Math.max(this.selDepth, ply);
    if (this.board.wk < 0) return this.board.whiteToMove ? -MATE + ply : MATE - ply;
    if (this.board.bk < 0) return this.board.whiteToMove ? MATE - ply : -MATE + ply;
    if (this.hardStop() || ply >= 12) return this.board.evaluate();

    let stand = this.board.evaluate();
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;

    const moves = this.moveBuf;
    const count = this.board.generateMoves(true, moves);
    this.order(moves, count, 0, ply);

    for (let i = 0; i < count; i += 1) {
      if (this.hardStop()) break;
      const m = moves[i]!;
      const cap = this.board.board[moveTo(m)]!;
      // Delta prune
      if (stand + pieceValue(cap) + 100 <= alpha) continue;
      this.board.make(m);
      const score = -this.qsearch(-beta, -alpha, ply + 1);
      this.board.unmake();
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  private pvs(
    depth: number,
    alpha: number,
    beta: number,
    ply: number,
    allowNull: boolean,
  ): number {
    this.nodes += 1;
    this.selDepth = Math.max(this.selDepth, ply);
    if (this.board.wk < 0) return this.board.whiteToMove ? -MATE + ply : MATE - ply;
    if (this.board.bk < 0) return this.board.whiteToMove ? MATE - ply : -MATE + ply;
    if (this.hardStop()) return this.board.evaluate();
    if (depth <= 0) return this.qsearch(alpha, beta, ply);

    const isPv = beta - alpha > 1;
    const key = hashBoard(this.board);
    const slot = key & this.ttMask;
    const tt = this.tt[slot];
    let ttMove = 0;
    if (tt && tt.key === key) {
      ttMove = tt.move;
      if (tt.depth >= depth) {
        if (tt.flag === 0) return tt.score;
        if (tt.flag === 1 && tt.score >= beta) return tt.score;
        if (tt.flag === 2 && tt.score <= alpha) return tt.score;
      }
    }

    const evalScore = this.board.evaluate();

    // Reverse futility
    if (!isPv && depth <= 6 && evalScore - (80 + depth * 65) >= beta && Math.abs(evalScore) < MATE - 1000) {
      return evalScore;
    }

    // Null move
    if (
      allowNull &&
      !isPv &&
      depth >= 3 &&
      evalScore >= beta + (this.fast ? 30 : 50)
    ) {
      // Skip null if no non-king material roughly — cheap check via eval magnitude
      this.board.whiteToMove = !this.board.whiteToMove;
      const R = 3 + (depth >> 2) + (this.fast ? 1 : 0);
      const nullScore = -this.pvs(depth - 1 - R, -beta, -beta + 1, ply + 1, false);
      this.board.whiteToMove = !this.board.whiteToMove;
      if (nullScore >= beta) return nullScore >= MATE - 1000 ? beta : nullScore;
      if (this.stopped) return evalScore;
    }

    const moves = this.moveBuf;
    // Use a local buffer copy for recursion safety — allocate per node is bad.
    // Instead generate into shared buffer then copy count moves to stack array.
    const count = this.board.generateMoves(false, moves);
    if (count === 0) return evalScore;

    const local = moves.slice(0, count);
    this.order(local, count, ttMove, ply);

    let best = -INF;
    let bestMove = local[0]!;
    let searched = 0;
    let quiets = 0;
    const originalAlpha = alpha;

    for (let i = 0; i < count; i += 1) {
      if (this.hardStop()) break;
      const m = local[i]!;
      const isCap = this.board.board[moveTo(m)]! !== 0;

      if (
        !isPv &&
        !isCap &&
        depth <= (this.fast ? 7 : 5) &&
        quiets >= (this.fast ? Math.max(1, (depth * depth) >> 1) : 2 + ((depth * depth + depth) >> 1))
      ) {
        continue;
      }

      this.board.make(m);
      let score: number;
      const newDepth = depth - 1;

      if (searched === 0) {
        score = -this.pvs(newDepth, -beta, -alpha, ply + 1, true);
      } else {
        let reduction = 0;
        if (
          searched >= 2 &&
          depth >= 3 &&
          !isCap &&
          this.board.whiteToMove !== undefined
        ) {
          reduction = Math.floor(
            (Math.log(depth) * Math.log(searched + 1)) / (this.fast ? 1.35 : 2.1),
          );
          if (this.fast && searched >= 4) reduction += 1;
          reduction = Math.min(reduction, Math.max(0, newDepth - 1));
        }
        score = -this.pvs(Math.max(0, newDepth - reduction), -alpha - 1, -alpha, ply + 1, true);
        if (reduction > 0 && score > alpha && !this.stopped) {
          score = -this.pvs(newDepth, -alpha - 1, -alpha, ply + 1, true);
        }
        if (score > alpha && score < beta && !this.stopped) {
          score = -this.pvs(newDepth, -beta, -alpha, ply + 1, true);
        }
      }
      this.board.unmake();
      searched += 1;
      if (!isCap) quiets += 1;

      if (score > best) {
        best = score;
        bestMove = m;
        if (isPv) {
          this.pv[ply] = [m, ...(this.pv[ply + 1] ?? [])];
        }
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (!isCap) {
          const k = this.killers[ply] ?? (this.killers[ply] = [0, 0]);
          if (k[0] !== m) {
            k[1] = k[0];
            k[0] = m;
          }
          const idx = (moveFrom(m) << 6) | moveTo(m);
          this.history[idx] = (this.history[idx] ?? 0) + depth * depth;
        }
        break;
      }
    }

    if (best === -INF) return evalScore;

    if (!this.stopped) {
      const flag: 0 | 1 | 2 =
        best <= originalAlpha ? 2 : best >= beta ? 1 : 0;
      this.tt[slot] = { key, depth, score: best, flag, move: bestMove };
    }
    return best;
  }

  rootSearch(depth: number, alpha: number, beta: number): {
    move: number;
    score: number;
    completed: boolean;
  } {
    const moves = this.moveBuf;
    const count = this.board.generateMoves(false, moves);
    if (count === 0) {
      return { move: 0, score: this.board.evaluate(), completed: true };
    }
    const local = moves.slice(0, count);
    const tt = this.tt[hashBoard(this.board) & this.ttMask];
    this.order(local, count, tt?.key === hashBoard(this.board) ? tt.move : 0, 0);

    let bestMove = local[0]!;
    let bestScore = -INF;
    let a = alpha;

    for (let i = 0; i < count; i += 1) {
      if (this.hardStop()) break;
      const m = local[i]!;
      this.board.make(m);
      this.pv[1] = [];
      let score: number;
      if (i === 0) {
        score = -this.pvs(depth - 1, -beta, -a, 1, true);
      } else {
        score = -this.pvs(depth - 1, -a - 1, -a, 1, true);
        if (score > a && score < beta && !this.stopped) {
          score = -this.pvs(depth - 1, -beta, -a, 1, true);
        }
      }
      this.board.unmake();
      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
        this.pv[0] = [m, ...(this.pv[1] ?? [])];
      }
      if (score > a) a = score;
      if (a >= beta) break;
    }

    return {
      move: bestMove,
      score: bestScore,
      completed: !this.stopped,
    };
  }
}

export function searchClassic(
  state: MatchState,
  optionsInput: SearchOptions,
  onIteration?: (partial: FullSearchResult) => void,
): FullSearchResult {
  const options = resolveOptions(optionsInput, true);
  const board = ClassicBoard.fromMatch(state);
  const search = new ClassicSearch(board, options.ttBits);
  search.fast = options.fastAnalysis;
  search.nodeLimit = options.nodeLimit;
  const started = Date.now();
  search.softDeadline = started + options.softTimeMs;
  search.hardDeadline = started + options.hardTimeMs;

  let bestMove = 0;
  let bestScore = 0;
  let completedDepth = 0;
  const rootMoves = search.moveBuf;
  if (board.generateMoves(false, rootMoves) === 0) {
    const score = board.evaluate();
    return {
      best: { type: 'endTurn' },
      score,
      scoreWhite: scoreWhite(state, score),
      pv: [],
      depth: 0,
      selDepth: 0,
      nodes: 0,
      nps: 0,
      elapsedMs: 0,
      stoppedBy: 'terminal',
    };
  }

  const overallSoft = search.softDeadline;

  for (let depth = 1; depth <= options.maxDepth; depth += 1) {
    if (depth > 1 && Date.now() >= overallSoft) {
      search.stoppedBy ??= 'softTime';
      break;
    }
    if (search.stopped && search.stoppedBy === 'softTime') {
      search.stopped = false;
      search.stoppedBy = null;
    }

    let delta = depth >= 4 ? 28 : INF;
    let alpha = completedDepth > 0 ? bestScore - delta : -INF;
    let beta = completedDepth > 0 ? bestScore + delta : INF;
    if (delta >= INF) {
      alpha = -INF;
      beta = INF;
    }

    let result = search.rootSearch(depth, alpha, beta);
    // Aspiration re-search
    let tries = 0;
    while (!search.stopped && delta < INF && tries < 4) {
      tries += 1;
      if (result.score <= alpha) {
        alpha = Math.max(-INF, result.score - delta);
        delta += (delta >> 1) + 8;
        result = search.rootSearch(depth, alpha, beta);
        continue;
      }
      if (result.score >= beta) {
        beta = Math.min(INF, result.score + delta);
        delta += (delta >> 1) + 8;
        result = search.rootSearch(Math.max(1, depth - 1), alpha, beta);
        continue;
      }
      break;
    }

    if (result.completed) {
      bestMove = result.move;
      bestScore = result.score;
      completedDepth = depth;
    } else if (!bestMove) {
      bestMove = result.move;
      bestScore = result.score;
    }

    if (bestMove && onIteration) {
      const elapsedMs = Math.max(0, Date.now() - started);
      const cmd = board.moveToCommand(bestMove);
      const pvCmds = (search.pv[0] ?? [bestMove]).map((m) => board.moveToCommand(m));
      onIteration({
        best: cmd,
        score: bestScore,
        scoreWhite: scoreWhite(state, bestScore),
        pv: pvCmds,
        depth: completedDepth,
        selDepth: search.selDepth,
        nodes: search.nodes,
        nps: elapsedMs > 0 ? Math.round((search.nodes * 1000) / elapsedMs) : 0,
        elapsedMs,
        stoppedBy: search.stoppedBy ?? 'depth',
      });
    }

    if (Math.abs(bestScore) >= MATE - 256) break;
    if (search.stoppedBy === 'nodes' || search.stoppedBy === 'hardTime') break;
    if (!result.completed && depth > 1) break;
  }

  const elapsedMs = Math.max(0, Date.now() - started);
  const best =
    bestMove !== 0
      ? board.moveToCommand(bestMove)
      : ({ type: 'endTurn' } as GameCommand);
  const pv = (search.pv[0] ?? (bestMove ? [bestMove] : [])).map((m) =>
    board.moveToCommand(m),
  );

  return {
    best,
    score: bestScore,
    scoreWhite: scoreWhite(state, bestScore),
    pv: pv.length > 0 ? pv : [best],
    depth: completedDepth,
    selDepth: search.selDepth,
    nodes: search.nodes,
    nps: elapsedMs > 0 ? Math.round((search.nodes * 1000) / elapsedMs) : 0,
    elapsedMs,
    stoppedBy:
      search.stoppedBy ??
      (completedDepth >= options.maxDepth ? 'depth' : 'softTime'),
  };
}
