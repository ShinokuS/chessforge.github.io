import type { Coord, PlayerId } from '../board/types.js';
import { coordsEqual, inBounds } from '../board/types.js';
import { findCavePartner, getTileDef, isPassable } from '../board/board.js';
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
  castle?: 'kingside' | 'queenside';
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
  if ((occupant.shieldTurns ?? 0) > 0) return 'blocked';
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
        // Chaplain-style buffs only empower allies
        if (hit.owner === buffer.owner && hit.id !== buffer.id) {
          targets.push(hit);
        }
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

function addCastlingMoves(state: MatchState, piece: PieceInstance, out: LegalMove[]): void {
  if (!isKingRole(piece.defId) || piece.hasMoved) return;
  if (piece.pos.x !== 4) return; // classic e-file

  const rank = piece.pos.y;
  const sides: Array<{
    side: 'kingside' | 'queenside';
    rookX: number;
    kingTo: number;
    path: number[];
  }> = [
    { side: 'kingside', rookX: 7, kingTo: 6, path: [5, 6] },
    { side: 'queenside', rookX: 0, kingTo: 2, path: [1, 2, 3] },
  ];

  for (const s of sides) {
    const rook = state.pieces.find(
      (p) =>
        p.owner === piece.owner &&
        getPieceDefinition(p.defId).baseRole === 'rook' &&
        p.pos.y === rank &&
        p.pos.x === s.rookX &&
        !p.hasMoved,
    );
    if (!rook) continue;

    let clear = true;
    for (const x of s.path) {
      const pos = { x, y: rank };
      if (!isPassable(state.board, pos) || pieceAt(state, pos)) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;

    out.push({
      from: { ...piece.pos },
      to: { x: s.kingTo, y: rank },
      captures: false,
      castle: s.side,
    });
  }
}

function addCaveMoves(state: MatchState, piece: PieceInstance, out: LegalMove[]): void {
  const tile = getTileDef(state.board, piece.pos);
  if (!tile?.caveGroup) return;
  const partner = findCavePartner(state.board, piece.pos);
  if (!partner) return;
  if (!isPassable(state.board, partner)) return;
  if (pieceAt(state, partner)) return;
  out.push({
    from: { ...piece.pos },
    to: { ...partner },
    captures: false,
  });
}

function addFreezeTargets(state: MatchState, piece: PieceInstance, out: LegalMove[]): void {
  const def = getPieceDefinition(piece.defId);
  if (!def.freezeInsteadOfCapture) return;
  if ((piece.freezeCooldown ?? 0) > 0) return;
  const range = def.freezeRange ?? 3;
  for (const enemy of state.pieces) {
    if (enemy.owner === piece.owner) continue;
    if ((enemy.shieldTurns ?? 0) > 0) continue;
    if (chebyshev(piece.pos, enemy.pos) > range) continue;
    out.push({
      from: { ...piece.pos },
      to: { ...enemy.pos },
      captures: true,
      targetPieceId: enemy.id,
    });
  }
}

function addAbilityMoves(state: MatchState, piece: PieceInstance, out: LegalMove[]): void {
  const def = getPieceDefinition(piece.defId);
  if (!def.abilities) return;

  for (const ability of def.abilities) {
    if (piece.abilitiesUsed[ability.id]) continue;

    if (ability.id === 'retreat') {
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

    if (ability.id === 'allyLeap') {
      for (const dir of [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ]) {
        const mid = { x: piece.pos.x + dir.x, y: piece.pos.y + dir.y };
        const land = { x: piece.pos.x + dir.x * 2, y: piece.pos.y + dir.y * 2 };
        if (!inBounds(mid, state.board.width, state.board.height)) continue;
        if (!inBounds(land, state.board.width, state.board.height)) continue;
        if (!isPassable(state.board, mid) || !isPassable(state.board, land)) continue;
        const jumpee = pieceAt(state, mid);
        if (!jumpee || jumpee.owner !== piece.owner) continue;
        if (pieceAt(state, land)) continue;
        out.push({
          from: { ...piece.pos },
          to: land,
          captures: false,
          abilityId: 'allyLeap',
        });
      }
    }

    if (ability.id === 'allySwap') {
      for (const pattern of def.movement) {
        if (pattern.kind !== 'slide') continue;
        const maxRange = resolveSlideRange(state, piece, pattern);
        for (const dir of pattern.directions) {
          for (let step = 1; step <= maxRange; step++) {
            const to = {
              x: piece.pos.x + dir.x * step,
              y: piece.pos.y + dir.y * step,
            };
            if (!inBounds(to, state.board.width, state.board.height)) break;
            if (!isPassable(state.board, to)) break;
            const hit = pieceAt(state, to);
            if (!hit) continue;
            if (hit.owner === piece.owner && hit.id !== piece.id) {
              out.push({
                from: { ...piece.pos },
                to: { ...hit.pos },
                captures: false,
                targetPieceId: hit.id,
                abilityId: 'allySwap',
              });
            }
            break;
          }
        }
      }
    }
  }
}

function dedupeMoves(moves: LegalMove[]): LegalMove[] {
  const seen = new Set<string>();
  const out: LegalMove[] = [];
  for (const m of moves) {
    const key = `${m.from.x},${m.from.y}->${m.to.x},${m.to.y}:${m.captures}:${m.abilityId ?? ''}:${m.castle ?? ''}`;
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
  if ((piece.frozenTurns ?? 0) > 0) return [];

  const def = getPieceDefinition(piece.defId);
  if (def.immobile) return [];

  const moves: LegalMove[] = [];

  if (def.freezeInsteadOfCapture) {
    for (const pattern of def.movement) {
      moves.push(...expandPattern(state, piece, pattern, 'quiet'));
    }
    addFreezeTargets(state, piece, moves);
  } else if (def.splitCapture && def.captureOffsets && !def.cannotCapture) {
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
    const captureMode = def.cannotCapture ? 'quiet' : 'both';
    for (const pattern of def.movement) {
      moves.push(...expandPattern(state, piece, pattern, captureMode));
    }
  }

  addAbilityMoves(state, piece, moves);
  addCaveMoves(state, piece, moves);
  addCastlingMoves(state, piece, moves);

  const buffed = getBuffedPieceIds(state);
  if (buffed.has(piece.id)) {
    addKingAuraMoves(state, piece, moves);
  }

  // Castling is exempt from mud distance cap (king jumps 2)
  const capped = applyMudCap(
    state,
    piece,
    moves.filter((m) => !m.castle),
  );
  const castles = moves.filter((m) => m.castle);
  return dedupeMoves([...capped, ...castles]);
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
