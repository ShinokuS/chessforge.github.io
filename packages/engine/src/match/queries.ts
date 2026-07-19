import type { MatchState } from './types.js';
import {
  getAllLegalMoves,
  getLegalMovesForPiece,
  type LegalMove,
} from '../pieces/movement.js';
import { coordsEqual } from '../board/types.js';
import type { Coord } from '../board/types.js';

export function getLegalMoves(state: MatchState, from?: Coord): LegalMove[] {
  if (!from) return getAllLegalMoves(state);
  const piece = state.pieces.find((p) => coordsEqual(p.pos, from));
  if (!piece) return [];
  return getLegalMovesForPiece(state, piece);
}

export function getPieceAt(state: MatchState, pos: Coord) {
  return state.pieces.find((p) => coordsEqual(p.pos, pos));
}
