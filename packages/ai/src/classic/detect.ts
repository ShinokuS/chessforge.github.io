import {
  getPieceDefinition,
  type MatchState,
  type PieceInstance,
} from '@chessforge/engine';

const CLASSIC_DEFS = new Set(['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']);

function pieceBlocked(p: PieceInstance): boolean {
  if ((p.frozenTurns ?? 0) > 0) return true;
  if ((p.freezeCooldown ?? 0) > 0) return true;
  if ((p.shieldTurns ?? 0) > 0) return true;
  if (p.spikeArmed || (p.spikeTicks ?? 0) > 0) return true;
  if (p.windPending) return true;
  if (p.promotesToBaseQueen) return true;
  if (p.cursedCannotHarmId) return true;
  if ((p.invisibleTurns ?? 0) > 0) return true;
  if (p.doubleMoveArmed) return true;
  if (p.reflectAvailable) return true;
  if (Object.keys(p.abilitiesUsed ?? {}).length > 0) return true;
  if (Object.keys(p.abilityCooldowns ?? {}).length > 0) return true;
  return false;
}

/**
 * True when the position is plain 8×8 classic chessforge rules
 * (base pieces only, no tile/mod state) — eligible for the fast search path.
 */
export function canUseClassicFastPath(state: MatchState): boolean {
  if (state.phase !== 'play') return false;
  if (state.extraMovePieceId) return false;
  if (state.board.width !== 8 || state.board.height !== 8) return false;

  const tiles = state.board.tiles;
  for (let y = 0; y < 8; y += 1) {
    const row = tiles[y];
    if (!row || row.length !== 8) return false;
    for (let x = 0; x < 8; x += 1) {
      if (row[x] !== 'plain') return false;
    }
  }

  for (const p of state.pieces) {
    if (!CLASSIC_DEFS.has(p.defId)) return false;
    if (pieceBlocked(p)) return false;
    const def = getPieceDefinition(p.defId);
    if (!def.isBase) return false;
    if (p.hp !== def.maxHp) return false;
    if (p.defId === 'king') {
      if (!p.isRoyal) return false;
    } else if (p.isRoyal) {
      return false;
    }
  }
  return true;
}
