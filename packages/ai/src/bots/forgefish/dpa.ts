import {
  getPieceDefinition,
  getTileDef,
  type MatchState,
} from '@chessforge/engine';

export type DeferredPhysics = {
  /** Spikes/wind/freeze ticks or mid-extra-move — unsafe for blind NMP. */
  hasDeferredThreats: boolean;
  /** endTurn likely changes evaluation (spikes tick, wind resolve). */
  endTurnMatters: boolean;
  spikePressure: number;
  windPending: number;
  freezeExpiring: number;
};

/**
 * Deferred Physics Awareness — classify delayed tile/status effects
 * so pruning (especially NMP via endTurn) stays sound on terrain.
 */
export function analyzeDeferredPhysics(state: MatchState): DeferredPhysics {
  let spikePressure = 0;
  let windPending = 0;
  let freezeExpiring = 0;

  for (const piece of state.pieces) {
    if (piece.spikeArmed) {
      spikePressure += piece.spikeTicks >= 1 ? 3 : 1;
    }
    if (piece.windPending) windPending += 1;
    const frozen = piece.frozenTurns ?? 0;
    if (frozen === 1) freezeExpiring += 1;

    const tile = getTileDef(state.board, piece.pos);
    if (tile?.spikesDoom && piece.spikeArmed && piece.spikeTicks >= 1) {
      spikePressure += 2;
    }
  }

  const midExtra = Boolean(state.extraMovePieceId);
  const hasDeferredThreats =
    midExtra || spikePressure > 0 || windPending > 0 || freezeExpiring > 0;

  return {
    hasDeferredThreats,
    endTurnMatters: spikePressure > 0 || windPending > 0 || midExtra,
    spikePressure,
    windPending,
    freezeExpiring,
  };
}

/** Safe for Stockfish-style null-move (pass via endTurn). */
export function canNullMove(state: MatchState, dpa: DeferredPhysics): boolean {
  if (state.extraMovePieceId) return false;
  if (dpa.hasDeferredThreats) return false;
  return true;
}

/** Whether a piece definition suggests combat that needs HP-aware SEE. */
export function needsHpSee(state: MatchState): boolean {
  for (const p of state.pieces) {
    const def = getPieceDefinition(p.defId);
    if (def.maxHp > 1 || def.freezeInsteadOfCapture || def.attack !== 1) return true;
  }
  return false;
}
