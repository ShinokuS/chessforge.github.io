import type { Coord, PlayerId } from '../board/types.js';
import { coordsEqual, inBounds } from '../board/types.js';
import { getTileDef, isPassable } from '../board/board.js';
import { getPieceDefinition } from '../defs/catalog.js';
import type {
  AbilityId,
  MatchState,
  MovementPattern,
  PieceInstance,
  PieceRole,
  SlidePattern,
} from '../match/types.js';

export type LegalMove = {
  from: Coord;
  to: Coord;
  captures: boolean;
  targetPieceId?: string;
  abilityId?: AbilityId;
};

const KING_OFFSETS: Coord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

function facingSign(owner: PlayerId): number {
  return owner === 'white' ? 1 : -1;
}

function orientOffset(owner: PlayerId, offset: Coord): Coord {
  return { x: offset.x, y: offset.y * facingSign(owner) };
}

function pieceAt(state: MatchState, pos: Coord): PieceInstance | undefined {
  return state.pieces.find((p) => coordsEqual(p.pos, pos));
}

function chebyshev(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function isKingRole(defId: string): boolean {
  return getPieceDefinition(defId).baseRole === 'king';
}

function resolveSlideRange(
  state: MatchState,
  mover: PieceInstance,
  pattern: SlidePattern,
): number {
  let range = pattern.maxRange;
  const fromTile = getTileDef(state.board, mover.pos);
  const def = getPieceDefinition(mover.defId);
  if (
    fromTile?.rangeBonus &&
    fromTile.rangeBonusRoles?.includes(def.baseRole)
  ) {
    range += fromTile.rangeBonus;
  }
  return Math.max(0, range);
}

function mountainLeapBonus(state: MatchState, mover: PieceInstance): number {
  const fromTile = getTileDef(state.board, mover.pos);
  const def = getPieceDefinition(mover.defId);
  if (
    fromTile?.rangeBonus &&
    fromTile.rangeBonusRoles?.includes(def.baseRole)
  ) {
    return fromTile.rangeBonus;
  }
  return 0;
}

function tryAddMove(
  state: MatchState,
  from: Coord,
  to: Coord,
  mode: 'quiet' | 'capture' | 'both',
  out: LegalMove[],
  abilityId?: AbilityId,
): 'empty' | 'blocked' | 'edge' {
  const { board } = state;
  if (!inBounds(to, board.width, board.height)) return 'edge';
  if (!isPassable(board, to)) return 'blocked';

  const mover = pieceAt(state, from);
  const occupant = pieceAt(state, to);
  if (!occupant) {
    if (mode === 'quiet' || mode === 'both') {
      out.push({
        from,
        to,
        captures: false,
        ...(abilityId !== undefined ? { abilityId } : {}),
      });
    }
    return 'empty';
  }
  if (mover && occupant.owner === mover.owner) return 'blocked';
  if (mode === 'capture' || mode === 'both') {
    out.push({
      from,
      to,
      captures: true,
      targetPieceId: occupant.id,
      ...(abilityId !== undefined ? { abilityId } : {}),
    });
  }
  return 'blocked';
}

function expandPattern(
  state: MatchState,
  mover: PieceInstance,
  pattern: MovementPattern,
  mode: 'quiet' | 'capture' | 'both',
): LegalMove[] {
  const moves: LegalMove[] = [];
  const leapBonus = mountainLeapBonus(state, mover);

  if (pattern.kind === 'conditional') {
    if (pattern.when === 'neverMoved' && mover.hasMoved) return moves;
    for (const nested of pattern.patterns) {
      moves.push(...expandPattern(state, mover, nested, mode));
    }
    return moves;
  }

  if (pattern.kind === 'leap') {
    for (const raw of pattern.offsets) {
      const base = orientOffset(mover.owner, raw);
      const to = { x: mover.pos.x + base.x, y: mover.pos.y + base.y };
      tryAddMove(state, mover.pos, to, mode, moves);
      if (leapBonus > 0 && raw.x === 0 && raw.y > 0) {
        const extended = orientOffset(mover.owner, { x: 0, y: raw.y + leapBonus });
        tryAddMove(
          state,
          mover.pos,
          { x: mover.pos.x + extended.x, y: mover.pos.y + extended.y },
          mode,
          moves,
        );
      }
    }
    return moves;
  }

  const maxRange = resolveSlideRange(state, mover, pattern);
  for (const dir of pattern.directions) {
    for (let step = 1; step <= maxRange; step++) {
      const to = {
        x: mover.pos.x + dir.x * step,
        y: mover.pos.y + dir.y * step,
      };
      const result = tryAddMove(state, mover.pos, to, mode, moves);
      if (result !== 'empty') break;
    }
  }
  return moves;
}

function applyMudCap(state: MatchState, mover: PieceInstance, moves: LegalMove[]): LegalMove[] {
  const tile = getTileDef(state.board, mover.pos);
  if (!tile?.movementCap) return moves;
  const def = getPieceDefinition(mover.defId);
  if (tile.movementCapImmuneRoles?.includes(def.baseRole)) return moves;
  const cap = tile.movementCap;
  return moves.filter((m) => chebyshev(m.from, m.to) <= cap);
}

function getLineBuffTargets(state: MatchState, buffer: PieceInstance): PieceInstance[] {
  const def = getPieceDefinition(buffer.defId);
  if (!def.lineBuff) return [];
  const targets: PieceInstance[] = [];
  for (const dir of def.lineBuff.directions) {
    for (let step = 1; step <= def.lineBuff.maxRange; step++) {
      const pos = {
        x: buffer.pos.x + dir.x * step,
        y: buffer.pos.y + dir.y * step,
      };
      if (!inBounds(pos, state.board.width, state.board.height)) break;
      if (!isPassable(state.board, pos)) break;
      const hit = pieceAt(state, pos);
      if (hit) {
        if (hit.id !== buffer.id) targets.push(hit);
        break;
      }
    }
  }
  return targets;
}

/** Piece ids currently receiving a chaplain-style line buff. */
export function getBuffedPieceIds(state: MatchState): Set<string> {
  const ids = new Set<string>();
  for (const p of state.pieces) {
    const def = getPieceDefinition(p.defId);
    if (!def.lineBuff) continue;
    for (const t of getLineBuffTargets(state, p)) {
      ids.add(t.id);
    }
  }
  return ids;
}

function addKingAuraMoves(state: MatchState, piece: PieceInstance, out: LegalMove[]): void {
  for (const off of KING_OFFSETS) {
    const to = { x: piece.pos.x + off.x, y: piece.pos.y + off.y };
    tryAddMove(state, piece.pos, to, 'both', out);
  }
}

function addAbilityMoves(state: MatchState, piece: PieceInstance, out: LegalMove[]): void {
  const def = getPieceDefinition(piece.defId);
  if (!def.abilities) return;

  for (const ability of def.abilities) {
    if (piece.abilitiesUsed[ability.id]) continue;

    if (ability.id === 'retreat') {
      // Backward rook slide (negative facing direction)
      const backDir = { x: 0, y: -facingSign(piece.owner) };
      for (let step = 1; step <= 8; step++) {
        const to = {
          x: piece.pos.x + backDir.x * step,
          y: piece.pos.y + backDir.y * step,
        };
        const result = tryAddMove(state, piece.pos, to, 'quiet', out, 'retreat');
        if (result !== 'empty') break;
      }
    }

    if (ability.id === 'royalWarp') {
      const king = state.pieces.find(
        (p) => p.owner === piece.owner && isKingRole(p.defId),
      );
      if (!king) continue;
      for (const off of KING_OFFSETS) {
        const to = { x: king.pos.x + off.x, y: king.pos.y + off.y };
        if (!inBounds(to, state.board.width, state.board.height)) continue;
        if (!isPassable(state.board, to)) continue;
        if (pieceAt(state, to)) continue;
        out.push({ from: piece.pos, to, captures: false, abilityId: 'royalWarp' });
      }
    }
  }
}

function dedupeMoves(moves: LegalMove[]): LegalMove[] {
  const seen = new Set<string>();
  const out: LegalMove[] = [];
  for (const m of moves) {
    const key = `${m.from.x},${m.from.y}->${m.to.x},${m.to.y}:${m.captures}:${m.abilityId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export function getLegalMovesForPiece(
  state: MatchState,
  piece: PieceInstance,
): LegalMove[] {
  if (state.phase !== 'play') return [];
  if (piece.owner !== state.activePlayer) return [];

  const def = getPieceDefinition(piece.defId);
  const moves: LegalMove[] = [];
  const captureMode = def.cannotCapture ? 'quiet' : 'both';

  if (def.splitCapture && def.captureOffsets && !def.cannotCapture) {
    for (const pattern of def.movement) {
      moves.push(...expandPattern(state, piece, pattern, 'quiet'));
    }
    const leapBonus = mountainLeapBonus(state, piece);
    for (const raw of def.captureOffsets) {
      let offset = orientOffset(piece.owner, raw);
      if (leapBonus > 0 && raw.x === 0 && raw.y > 0) {
        offset = orientOffset(piece.owner, { x: 0, y: raw.y + leapBonus });
      }
      const to = { x: piece.pos.x + offset.x, y: piece.pos.y + offset.y };
      tryAddMove(state, piece.pos, to, 'capture', moves);
    }
  } else {
    for (const pattern of def.movement) {
      moves.push(...expandPattern(state, piece, pattern, captureMode));
    }
  }

  addAbilityMoves(state, piece, moves);

  const buffed = getBuffedPieceIds(state);
  if (buffed.has(piece.id)) {
    addKingAuraMoves(state, piece, moves);
  }

  return dedupeMoves(applyMudCap(state, piece, moves));
}

export function getAllLegalMoves(state: MatchState): LegalMove[] {
  return state.pieces.flatMap((p) => getLegalMovesForPiece(state, p));
}

export function findLegalMove(
  state: MatchState,
  from: Coord,
  to: Coord,
  abilityId?: AbilityId,
): LegalMove | undefined {
  const piece = pieceAt(state, from);
  if (!piece) return undefined;
  return getLegalMovesForPiece(state, piece).find(
    (m) =>
      coordsEqual(m.to, to) &&
      (abilityId === undefined || m.abilityId === abilityId),
  );
}

export type { PieceRole };
