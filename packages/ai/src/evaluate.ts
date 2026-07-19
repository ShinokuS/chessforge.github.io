import {
  getBuffedPieceIds,
  getLegalMoves,
  getPieceDefinition,
  getTileDef,
  type MatchState,
  type PieceInstance,
  type PieceRole,
  type PlayerId,
} from '@chessforge/engine';

const ROLE_VALUE: Record<PieceRole, number> = {
  king: 10_000,
  queen: 90,
  rook: 50,
  bishop: 32,
  knight: 30,
  pawn: 10,
};

const MOD_BONUS: Record<string, number> = {
  skirmisher: 6,
  ironclad: 12,
  spearman: 8,
  sprinter: 10,
  sentry: -4,
  lancer: 5,
  outrider: 14,
  chaplain: 16,
  exchanger: 12,
  regent: 22,
  cryomancer: 18,
  warden: 20,
  anchor: -8,
};

const ABILITY_VALUE: Record<string, number> = {
  retreat: 8,
  royalWarp: 12,
  allyLeap: 10,
  allySwap: 14,
};

function pieceMaterial(piece: PieceInstance): number {
  const def = getPieceDefinition(piece.defId);
  const base = ROLE_VALUE[def.baseRole];
  const mod = def.isBase ? 0 : (MOD_BONUS[def.id] ?? def.cost * 5);
  const hpFactor = def.maxHp > 0 ? piece.hp / def.maxHp : 1;
  return (base + mod) * hpFactor;
}

function tileTerms(piece: PieceInstance, perspective: PlayerId, state: MatchState): number {
  const tile = getTileDef(state.board, piece.pos);
  if (!tile) return 0;
  const mine = piece.owner === perspective;
  let score = 0;

  if (tile.spikesDoom && piece.spikeArmed) {
    const urgency = piece.spikeTicks >= 1 ? 35 : 18;
    score += mine ? -urgency : urgency;
  }
  if (tile.id === 'mud' && mine) score -= 4;
  if (tile.id === 'mountain' && mine && getPieceDefinition(piece.defId).baseRole === 'pawn') {
    score += 3;
  }
  if (tile.id === 'cave' && mine) score += 1;

  return score;
}

/**
 * Static evaluation from `perspective`'s point of view (higher = better for them).
 */
export function evaluate(state: MatchState, perspective: PlayerId): number {
  if (state.phase === 'gameOver') {
    if (state.winner === perspective) return 100_000;
    if (state.winner && state.winner !== perspective) return -100_000;
    return 0;
  }

  let score = 0;
  const buffed = getBuffedPieceIds(state);
  const cx = (state.board.width - 1) / 2;
  const cy = (state.board.height - 1) / 2;

  for (const piece of state.pieces) {
    const mat = pieceMaterial(piece);
    score += piece.owner === perspective ? mat : -mat;
    score += tileTerms(piece, perspective, state);

    const def = getPieceDefinition(piece.defId);
    if (piece.owner === perspective && def.abilities) {
      for (const ab of def.abilities) {
        if (!piece.abilitiesUsed[ab.id]) {
          score += ABILITY_VALUE[ab.id] ?? 5;
        }
      }
    }

    if (buffed.has(piece.id)) {
      score += piece.owner === perspective ? 6 : -6;
    }

    if (piece.owner === perspective) {
      const dist = Math.abs(piece.pos.x - cx) + Math.abs(piece.pos.y - cy);
      score += Math.max(0, 5 - dist) * 0.2;
    }
  }

  if (state.activePlayer === perspective) {
    score += getLegalMoves(state).length * 0.15;
  }

  return score;
}

export function pieceTacticalValue(defId: string): number {
  const def = getPieceDefinition(defId);
  return ROLE_VALUE[def.baseRole] + (def.isBase ? 0 : (MOD_BONUS[def.id] ?? 0));
}
