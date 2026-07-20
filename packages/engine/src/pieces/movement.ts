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
  /** Ram push: target is shoved to `to`, mover stays. */
  push?: boolean;
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

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * For multi-step leaps (pawn double-push, spearman ×2, mountain-extended…),
 * intermediate squares must be empty and passable. Knight-like leaps (gcd=1) skip this.
 */
function pathClear(state: MatchState, from: Coord, to: Coord): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = gcd(dx, dy);
  if (steps <= 1) return true;
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 1; i < steps; i++) {
    const mid = { x: from.x + sx * i, y: from.y + sy * i };
    if (!isPassable(state.board, mid)) return false;
    if (pieceAt(state, mid)) return false;
  }
  return true;
}

function isKingRole(defId: string): boolean {
  return getPieceDefinition(defId).baseRole === 'king';
}

function isRoyalPiece(p: PieceInstance): boolean {
  return Boolean(p.isRoyal);
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
  if (!pathClear(state, from, to)) return 'blocked';

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
  if (
    mover?.cursedCannotHarmId &&
    occupant.id === mover.cursedCannotHarmId
  ) {
    return 'blocked';
  }
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
  // Ram push: mover stays put — distance-to-landing must not block the shove.
  return moves.filter((m) => m.push || chebyshev(m.from, m.to) <= cap);
}

function isMarshSlowed(state: MatchState, mover: PieceInstance): boolean {
  for (const aura of state.pieces) {
    if (aura.owner === mover.owner) continue;
    const auraDef = getPieceDefinition(aura.defId);
    if (!auraDef.marshAuraRadius) continue;
    if (chebyshev(mover.pos, aura.pos) <= auraDef.marshAuraRadius) return true;
  }
  return false;
}

/** True if an enemy marsh aura currently caps this piece's move distance (knights ignore it). */
export function isPieceMarshSlowed(state: MatchState, piece: PieceInstance): boolean {
  const def = getPieceDefinition(piece.defId);
  if (def.baseRole === 'knight') return false;
  return isMarshSlowed(state, piece);
}

function applyMarshAuraCap(
  state: MatchState,
  mover: PieceInstance,
  moves: LegalMove[],
): LegalMove[] {
  if (!isMarshSlowed(state, mover)) return moves;
  const def = getPieceDefinition(mover.defId);
  const cap = 1;
  if (def.baseRole === 'knight') return moves;
  return moves.filter((m) => m.push || chebyshev(m.from, m.to) <= cap);
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

function addRoyalEscortMoves(state: MatchState, piece: PieceInstance, out: LegalMove[]): void {
  const def = getPieceDefinition(piece.defId);
  if (!def.royalEscort) return;
  const kingNear = state.pieces.some(
    (p) =>
      p.owner === piece.owner &&
      p.isRoyal &&
      p.id !== piece.id &&
      chebyshev(p.pos, piece.pos) === 1,
  );
  if (!kingNear) return;
  addKingAuraMoves(state, piece, out);
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

function addRamPush(state: MatchState, piece: PieceInstance, out: LegalMove[]): void {
  const def = getPieceDefinition(piece.defId);
  if (!def.pushForward) return;
  const fwd = facingSign(piece.owner);
  const ahead = { x: piece.pos.x, y: piece.pos.y + fwd };
  if (!inBounds(ahead, state.board.width, state.board.height)) return;
  const victim = pieceAt(state, ahead);
  if (!victim) return;
  if ((victim.shieldTurns ?? 0) > 0) return;
  const dest = { x: ahead.x, y: ahead.y + fwd };
  if (!inBounds(dest, state.board.width, state.board.height)) return;
  if (!isPassable(state.board, dest)) return;
  if (pieceAt(state, dest)) return;
  out.push({
    from: { ...piece.pos },
    to: { ...dest },
    captures: false,
    targetPieceId: victim.id,
    push: true,
  });
}

function abilityReady(piece: PieceInstance, abilityId: AbilityId, cooldownTurns?: number): boolean {
  if (cooldownTurns !== undefined) {
    return (piece.abilityCooldowns?.[abilityId] ?? 0) <= 0;
  }
  return !piece.abilitiesUsed[abilityId];
}

function addAbilityMoves(state: MatchState, piece: PieceInstance, out: LegalMove[]): void {
  const def = getPieceDefinition(piece.defId);
  if (!def.abilities) return;

  for (const ability of def.abilities) {
    if (!abilityReady(piece, ability.id, ability.cooldownTurns)) continue;

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
      const royal = state.pieces.find((p) => p.owner === piece.owner && isRoyalPiece(p));
      if (!royal) continue;
      for (const off of KING_OFFSETS) {
        const to = { x: royal.pos.x + off.x, y: royal.pos.y + off.y };
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

    if (ability.id === 'blessHeal') {
      for (const ally of state.pieces) {
        if (ally.owner !== piece.owner || ally.id === piece.id) continue;
        if (chebyshev(piece.pos, ally.pos) > 3) continue;
        out.push({
          from: { ...piece.pos },
          to: { ...ally.pos },
          captures: false,
          targetPieceId: ally.id,
          abilityId: 'blessHeal',
        });
      }
    }

    if (ability.id === 'abdicate') {
      for (const ally of state.pieces) {
        if (ally.owner !== piece.owner || ally.id === piece.id) continue;
        if (getPieceDefinition(ally.defId).baseRole !== 'queen') continue;
        out.push({
          from: { ...piece.pos },
          to: { ...ally.pos },
          captures: false,
          targetPieceId: ally.id,
          abilityId: 'abdicate',
        });
      }
    }

    if (ability.id === 'grantShield') {
      for (const ally of state.pieces) {
        if (ally.owner !== piece.owner || ally.id === piece.id) continue;
        out.push({
          from: { ...piece.pos },
          to: { ...ally.pos },
          captures: false,
          targetPieceId: ally.id,
          abilityId: 'grantShield',
        });
      }
    }

    if (ability.id === 'designatePromote') {
      for (const ally of state.pieces) {
        if (ally.owner !== piece.owner) continue;
        if (getPieceDefinition(ally.defId).baseRole !== 'pawn') continue;
        if (ally.promotesToBaseQueen) continue;
        out.push({
          from: { ...piece.pos },
          to: { ...ally.pos },
          captures: false,
          targetPieceId: ally.id,
          abilityId: 'designatePromote',
        });
      }
    }

    // frontBless is passive (auto) — not a clickable ability move.

    if (ability.id === 'curseEnemy') {
      for (const enemy of state.pieces) {
        if (enemy.owner === piece.owner) continue;
        out.push({
          from: { ...piece.pos },
          to: { ...enemy.pos },
          captures: false,
          targetPieceId: enemy.id,
          abilityId: 'curseEnemy',
        });
      }
    }

    if (ability.id === 'cloakPawn') {
      for (const ally of state.pieces) {
        if (ally.owner !== piece.owner) continue;
        if (getPieceDefinition(ally.defId).baseRole !== 'pawn') continue;
        out.push({
          from: { ...piece.pos },
          to: { ...ally.pos },
          captures: false,
          targetPieceId: ally.id,
          abilityId: 'cloakPawn',
        });
      }
    }

    if (ability.id === 'judgeBless') {
      if (state.turn < 10) continue;
      const mine = state.pieces.filter((p) => p.owner === piece.owner).length;
      const theirs = state.pieces.filter((p) => p.owner !== piece.owner).length;
      if (mine <= theirs) continue;
      for (const ally of state.pieces) {
        if (ally.owner !== piece.owner || ally.id === piece.id) continue;
        out.push({
          from: { ...piece.pos },
          to: { ...ally.pos },
          captures: false,
          targetPieceId: ally.id,
          abilityId: 'judgeBless',
        });
      }
    }
  }
}

function addSpikePlacerMoves(state: MatchState, piece: PieceInstance, out: LegalMove[]): void {
  const def = getPieceDefinition(piece.defId);
  if (!def.spikePlacer) return;
  if (piece.abilitiesUsed.spikeTile) return;
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
        const tileId = state.board.tiles[to.y]?.[to.x];
        if (tileId !== 'plain') break;
        out.push({
          from: { ...piece.pos },
          to,
          captures: false,
          abilityId: 'spikeTile',
        });
        if (pieceAt(state, to)) break;
      }
    }
  }
}

function dedupeMoves(moves: LegalMove[]): LegalMove[] {
  const seen = new Set<string>();
  const out: LegalMove[] = [];
  for (const m of moves) {
    const key = `${m.from.x},${m.from.y}->${m.to.x},${m.to.y}:${m.captures}:${m.abilityId ?? ''}:${m.castle ?? ''}:${m.push ? 1 : 0}:${m.targetPieceId ?? ''}`;
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
  if (state.extraMovePieceId && state.extraMovePieceId !== piece.id) return [];
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
  addSpikePlacerMoves(state, piece, moves);
  addRamPush(state, piece, moves);
  addCaveMoves(state, piece, moves);
  addCastlingMoves(state, piece, moves);
  addRoyalEscortMoves(state, piece, moves);

  const buffed = getBuffedPieceIds(state);
  if (buffed.has(piece.id)) {
    addKingAuraMoves(state, piece, moves);
  }

  // Castling is exempt from mud distance cap (king jumps 2)
  const capped = applyMarshAuraCap(
    state,
    piece,
    applyMudCap(
      state,
      piece,
      moves.filter((m) => !m.castle),
    ),
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
  push?: boolean,
): LegalMove | undefined {
  const piece = pieceAt(state, from);
  if (!piece) return undefined;
  const moves = getLegalMovesForPiece(state, piece).filter((m) => coordsEqual(m.to, to));
  if (abilityId !== undefined) {
    return moves.find((m) => m.abilityId === abilityId);
  }
  if (push === true) {
    return moves.find((m) => Boolean(m.push));
  }
  if (push === false) {
    return moves.find((m) => !m.push);
  }
  // Prefer a normal move when both a quiet step and a ram-push share `to`.
  return moves.find((m) => !m.push) ?? moves[0];
}

export type { PieceRole };
