import type { MatchState, PieceInstance } from '@chessforge/engine';

function sortedRecord(record: Readonly<Record<string, unknown>>): string {
  return Object.keys(record)
    .sort()
    .map((key) => `${key}:${String(record[key])}`)
    .join(',');
}

function pieceKey(piece: PieceInstance): string {
  return [
    piece.id,
    piece.defId,
    piece.owner,
    piece.pos.x,
    piece.pos.y,
    piece.hp,
    Number(piece.hasMoved),
    sortedRecord(piece.abilitiesUsed),
    sortedRecord(piece.abilityCooldowns),
    Number(piece.spikeArmed),
    piece.spikeTicks,
    piece.frozenTurns,
    piece.freezeCooldown,
    Number(piece.windPending),
    piece.shieldTurns,
    Number(piece.isRoyal),
    Number(piece.reflectAvailable),
    Number(piece.promotesToBaseQueen),
    piece.cursedCannotHarmId ?? '',
    piece.invisibleTurns ?? 0,
    Number(piece.doubleMoveArmed),
  ].join(':');
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function evaluationStateSignature(state: MatchState): string {
  const pieces = [...state.pieces]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(pieceKey)
    .join('|');
  const board = state.board.tiles.map((row) => row.join(',')).join('/');
  const skip = state.skipFirstTurnUsed ?? {};
  return [
    state.board.width,
    state.board.height,
    board,
    pieces,
    state.activePlayer,
    state.turn,
    state.phase,
    state.winner ?? '',
    state.seed,
    state.rngStep,
    state.extraMovePieceId ?? '',
    sortedRecord(skip),
    (state.openingSkipSequence ?? []).join(','),
  ].join('#');
}

export function evaluationStateKey(signature: string): string {
  return `${signature.length.toString(36)}:${hashString(signature)}`;
}
