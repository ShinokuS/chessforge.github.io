/**
 * Ultra-fast classic Chessforge board: mailbox + make/unmake.
 * Rules: capture the king wins; no en passant; optional castling; pawn→queen.
 */
import type { GameCommand, MatchState, PlayerId } from '@chessforge/engine';

export const EMPTY = 0;
export const WP = 1;
export const WN = 2;
export const WB = 3;
export const WR = 4;
export const WQ = 5;
export const WK = 6;
export const BP = 9;
export const BN = 10;
export const BB = 11;
export const BR = 12;
export const BQ = 13;
export const BK = 14;

const WHITE_MASK = 8; // black pieces have bit 3 set (8+)

export function isWhite(p: number): boolean {
  return p > 0 && p < WHITE_MASK;
}
export function isBlack(p: number): boolean {
  return p >= WHITE_MASK;
}
export function sameColor(a: number, b: number): boolean {
  if (a === 0 || b === 0) return false;
  return isWhite(a) === isWhite(b);
}

const ROLE_OF = new Int8Array(16);
ROLE_OF[WP] = 1;
ROLE_OF[WN] = 2;
ROLE_OF[WB] = 3;
ROLE_OF[WR] = 4;
ROLE_OF[WQ] = 5;
ROLE_OF[WK] = 6;
ROLE_OF[BP] = 1;
ROLE_OF[BN] = 2;
ROLE_OF[BB] = 3;
ROLE_OF[BR] = 4;
ROLE_OF[BQ] = 5;
ROLE_OF[BK] = 6;

export function roleOf(p: number): number {
  return ROLE_OF[p] ?? 0;
}

const VALUE = new Int32Array(16);
VALUE[WP] = 100;
VALUE[WN] = 300;
VALUE[WB] = 320;
VALUE[WR] = 500;
VALUE[WQ] = 900;
VALUE[WK] = 0;
VALUE[BP] = 100;
VALUE[BN] = 300;
VALUE[BB] = 320;
VALUE[BR] = 500;
VALUE[BQ] = 900;
VALUE[BK] = 0;

export function pieceValue(p: number): number {
  return VALUE[p] ?? 0;
}

const DEF_TO_PIECE: Record<string, { w: number; b: number }> = {
  pawn: { w: WP, b: BP },
  knight: { w: WN, b: BN },
  bishop: { w: WB, b: BB },
  rook: { w: WR, b: BR },
  queen: { w: WQ, b: BQ },
  king: { w: WK, b: BK },
};

export function sq(x: number, y: number): number {
  return y * 8 + x;
}
export function sqX(s: number): number {
  return s & 7;
}
export function sqY(s: number): number {
  return s >> 3;
}

/** Move packed: from(6) | to(6) | promoRole(3) | isCastle(1) */
export function packMove(from: number, to: number, promo = 0, castle = 0): number {
  return from | (to << 6) | (promo << 12) | (castle << 15);
}
export function moveFrom(m: number): number {
  return m & 63;
}
export function moveTo(m: number): number {
  return (m >> 6) & 63;
}
export function movePromo(m: number): number {
  return (m >> 12) & 7;
}
export function moveCastle(m: number): number {
  return (m >> 15) & 1;
}

type Undo = {
  move: number;
  captured: number;
  fromPiece: number;
  castleRights: number;
  wk: number;
  bk: number;
};

export class ClassicBoard {
  /** 64 mailbox */
  board = new Int8Array(64);
  whiteToMove = true;
  /** bit0 white O-O, bit1 white O-O-O, bit2 black O-O, bit3 black O-O-O */
  castleRights = 0;
  wk = -1;
  bk = -1;
  private undo: Undo[] = [];
  nodes = 0;

  clone(): ClassicBoard {
    const c = new ClassicBoard();
    c.board.set(this.board);
    c.whiteToMove = this.whiteToMove;
    c.castleRights = this.castleRights;
    c.wk = this.wk;
    c.bk = this.bk;
    return c;
  }

  static fromMatch(state: MatchState): ClassicBoard {
    const b = new ClassicBoard();
    b.whiteToMove = state.activePlayer === 'white';
    let whiteKingUnmoved = false;
    let blackKingUnmoved = false;
    for (const p of state.pieces) {
      const map = DEF_TO_PIECE[p.defId];
      if (!map) continue;
      const piece = p.owner === 'white' ? map.w : map.b;
      const s = sq(p.pos.x, p.pos.y);
      b.board[s] = piece;
      if (piece === WK) {
        b.wk = s;
        whiteKingUnmoved = !p.hasMoved;
      }
      if (piece === BK) {
        b.bk = s;
        blackKingUnmoved = !p.hasMoved;
      }
    }
    for (const p of state.pieces) {
      if (p.defId !== 'rook' || p.hasMoved) continue;
      if (p.owner === 'white' && whiteKingUnmoved) {
        if (p.pos.x === 7 && p.pos.y === 0) b.castleRights |= 1;
        if (p.pos.x === 0 && p.pos.y === 0) b.castleRights |= 2;
      }
      if (p.owner === 'black' && blackKingUnmoved) {
        if (p.pos.x === 7 && p.pos.y === 7) b.castleRights |= 4;
        if (p.pos.x === 0 && p.pos.y === 7) b.castleRights |= 8;
      }
    }
    return b;
  }

  /** Side to move lost their king? */
  kingMissing(white: boolean): boolean {
    return white ? this.wk < 0 || this.board[this.wk] !== WK : this.bk < 0 || this.board[this.bk] !== BK;
  }

  /** Static eval from side-to-move POV (centipawns). */
  evaluate(): number {
    if (this.wk < 0) return this.whiteToMove ? -100_000 : 100_000;
    if (this.bk < 0) return this.whiteToMove ? 100_000 : -100_000;
    let score = 0;
    const board = this.board;
    for (let s = 0; s < 64; s += 1) {
      const p = board[s]!;
      if (!p) continue;
      const v = VALUE[p]!;
      const x = s & 7;
      const y = s >> 3;
      const center = 3 - Math.abs(3.5 - x) - Math.abs(3.5 - y);
      if (isWhite(p)) {
        score += v;
        score += center * (p === WP ? 2 : 1);
        if (p === WP) score += y * 4;
      } else {
        score -= v;
        score -= center * (p === BP ? 2 : 1);
        if (p === BP) score -= (7 - y) * 4;
      }
    }
    return this.whiteToMove ? score : -score;
  }

  generateMoves(capturesOnly: boolean, out: number[]): number {
    let n = 0;
    const board = this.board;
    const white = this.whiteToMove;
    const fwd = white ? 8 : -8;
    const promoRank = white ? 7 : 0;
    const startRank = white ? 1 : 6;

    for (let from = 0; from < 64; from += 1) {
      const p = board[from]!;
      if (!p) continue;
      if (white !== isWhite(p)) continue;
      const role = ROLE_OF[p]!;

      if (role === 1) {
        // Pawn
        const to1 = from + fwd;
        if (to1 >= 0 && to1 < 64 && !board[to1]) {
          if (!capturesOnly) {
            if ((to1 >> 3) === promoRank) {
              out[n++] = packMove(from, to1, 5);
            } else {
              out[n++] = packMove(from, to1);
              if ((from >> 3) === startRank) {
                const to2 = from + fwd * 2;
                if (to2 >= 0 && to2 < 64 && !board[to2]) {
                  out[n++] = packMove(from, to2);
                }
              }
            }
          }
        }
        const fx = from & 7;
        for (const dx of [-1, 1]) {
          const x = fx + dx;
          if (x < 0 || x > 7) continue;
          const to = from + fwd + dx;
          if (to < 0 || to >= 64) continue;
          const vict = board[to]!;
          if (!vict || sameColor(p, vict)) continue;
          if ((to >> 3) === promoRank) out[n++] = packMove(from, to, 5);
          else out[n++] = packMove(from, to);
        }
        continue;
      }

      if (role === 2) {
        // Knight
        const ox = [-1, 1, -2, 2, -2, 2, -1, 1];
        const oy = [2, 2, 1, 1, -1, -1, -2, -2];
        const fx = from & 7;
        const fy = from >> 3;
        for (let i = 0; i < 8; i += 1) {
          const x = fx + ox[i]!;
          const y = fy + oy[i]!;
          if (x < 0 || x > 7 || y < 0 || y > 7) continue;
          const to = y * 8 + x;
          const vict = board[to]!;
          if (vict && sameColor(p, vict)) continue;
          if (capturesOnly && !vict) continue;
          out[n++] = packMove(from, to);
        }
        continue;
      }

      if (role === 6) {
        // King
        const fx = from & 7;
        const fy = from >> 3;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const x = fx + dx;
            const y = fy + dy;
            if (x < 0 || x > 7 || y < 0 || y > 7) continue;
            const to = y * 8 + x;
            const vict = board[to]!;
            if (vict && sameColor(p, vict)) continue;
            if (capturesOnly && !vict) continue;
            out[n++] = packMove(from, to);
          }
        }
        if (!capturesOnly) {
          n = this.genCastles(from, p, out, n);
        }
        continue;
      }

      // Sliders: bishop(3) rook(4) queen(5)
      const dirs: Array<[number, number]> = [];
      if (role === 3 || role === 5) {
        dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
      }
      if (role === 4 || role === 5) {
        dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
      }
      const fx = from & 7;
      const fy = from >> 3;
      for (const [dx, dy] of dirs) {
        let x = fx + dx;
        let y = fy + dy;
        while (x >= 0 && x <= 7 && y >= 0 && y <= 7) {
          const to = y * 8 + x;
          const vict = board[to]!;
          if (vict) {
            if (!sameColor(p, vict)) out[n++] = packMove(from, to);
            break;
          }
          if (!capturesOnly) out[n++] = packMove(from, to);
          x += dx;
          y += dy;
        }
      }
    }
    return n;
  }

  private genCastles(from: number, king: number, out: number[], n: number): number {
    const board = this.board;
    const white = isWhite(king);
    const rights = this.castleRights;
    if (white) {
      if (from !== sq(4, 0)) return n;
      // O-O
      if (rights & 1 && !board[sq(5, 0)] && !board[sq(6, 0)] && board[sq(7, 0)] === WR) {
        out[n++] = packMove(from, sq(6, 0), 0, 1);
      }
      // O-O-O
      if (
        rights & 2 &&
        !board[sq(3, 0)] &&
        !board[sq(2, 0)] &&
        !board[sq(1, 0)] &&
        board[sq(0, 0)] === WR
      ) {
        out[n++] = packMove(from, sq(2, 0), 0, 1);
      }
    } else {
      if (from !== sq(4, 7)) return n;
      if (rights & 4 && !board[sq(5, 7)] && !board[sq(6, 7)] && board[sq(7, 7)] === BR) {
        out[n++] = packMove(from, sq(6, 7), 0, 1);
      }
      if (
        rights & 8 &&
        !board[sq(3, 7)] &&
        !board[sq(2, 7)] &&
        !board[sq(1, 7)] &&
        board[sq(0, 7)] === BR
      ) {
        out[n++] = packMove(from, sq(2, 7), 0, 1);
      }
    }
    return n;
  }

  make(move: number): void {
    const from = moveFrom(move);
    const to = moveTo(move);
    const board = this.board;
    const piece = board[from]!;
    const captured = board[to]!;
    const castle = moveCastle(move);
    const promo = movePromo(move);

    this.undo.push({
      move,
      captured,
      fromPiece: piece,
      castleRights: this.castleRights,
      wk: this.wk,
      bk: this.bk,
    });

    board[from] = EMPTY;
    let placed = piece;
    if (promo) {
      placed = isWhite(piece) ? promo : promo + 8;
    }
    board[to] = placed;

    if (piece === WK) this.wk = to;
    if (piece === BK) this.bk = to;
    if (captured === WK) this.wk = -1;
    if (captured === BK) this.bk = -1;

    // Castling rook move
    if (castle) {
      if (to === sq(6, 0)) {
        board[sq(7, 0)] = EMPTY;
        board[sq(5, 0)] = WR;
      } else if (to === sq(2, 0)) {
        board[sq(0, 0)] = EMPTY;
        board[sq(3, 0)] = WR;
      } else if (to === sq(6, 7)) {
        board[sq(7, 7)] = EMPTY;
        board[sq(5, 7)] = BR;
      } else if (to === sq(2, 7)) {
        board[sq(0, 7)] = EMPTY;
        board[sq(3, 7)] = BR;
      }
    }

    // Update castling rights
    if (piece === WK) this.castleRights &= ~3;
    if (piece === BK) this.castleRights &= ~12;
    if (from === sq(0, 0) || to === sq(0, 0)) this.castleRights &= ~2;
    if (from === sq(7, 0) || to === sq(7, 0)) this.castleRights &= ~1;
    if (from === sq(0, 7) || to === sq(0, 7)) this.castleRights &= ~8;
    if (from === sq(7, 7) || to === sq(7, 7)) this.castleRights &= ~4;

    this.whiteToMove = !this.whiteToMove;
  }

  unmake(): void {
    const u = this.undo.pop();
    if (!u) return;
    const from = moveFrom(u.move);
    const to = moveTo(u.move);
    const board = this.board;
    const castle = moveCastle(u.move);

    this.whiteToMove = !this.whiteToMove;
    this.castleRights = u.castleRights;
    this.wk = u.wk;
    this.bk = u.bk;

    if (castle) {
      if (to === sq(6, 0)) {
        board[sq(5, 0)] = EMPTY;
        board[sq(7, 0)] = WR;
      } else if (to === sq(2, 0)) {
        board[sq(3, 0)] = EMPTY;
        board[sq(0, 0)] = WR;
      } else if (to === sq(6, 7)) {
        board[sq(5, 7)] = EMPTY;
        board[sq(7, 7)] = BR;
      } else if (to === sq(2, 7)) {
        board[sq(3, 7)] = EMPTY;
        board[sq(0, 7)] = BR;
      }
    }

    board[from] = u.fromPiece;
    board[to] = u.captured;
  }

  moveToCommand(move: number): GameCommand {
    const from = moveFrom(move);
    const to = moveTo(move);
    return {
      type: 'move',
      from: { x: sqX(from), y: sqY(from) },
      to: { x: sqX(to), y: sqY(to) },
    };
  }
}

export function stmPlayer(board: ClassicBoard): PlayerId {
  return board.whiteToMove ? 'white' : 'black';
}
