import type { AbilityId } from '../match/types.js';
import type { Coord } from '../board/types.js';

export type GameCommand =
  | { type: 'move'; from: Coord; to: Coord; abilityId?: AbilityId }
  | { type: 'endTurn' };

export type GameEvent =
  | { type: 'Moved'; pieceId: string; from: Coord; to: Coord; abilityId?: AbilityId }
  | {
      type: 'Castled';
      side: 'kingside' | 'queenside';
      kingId: string;
      rookId: string;
      kingFrom: Coord;
      kingTo: Coord;
      rookFrom: Coord;
      rookTo: Coord;
    }
  | { type: 'Damaged'; pieceId: string; byPieceId: string; at: Coord; from: Coord; hpLeft: number }
  | { type: 'Captured'; pieceId: string; byPieceId: string; at: Coord; defId: string }
  | {
      type: 'Frozen';
      pieceId: string;
      byPieceId: string;
      at: Coord;
      from: Coord;
    }
  | {
      type: 'Swapped';
      pieceId: string;
      withPieceId: string;
      from: Coord;
      to: Coord;
    }
  | { type: 'Teleported'; pieceId: string; from: Coord; to: Coord; tileId: string }
  | { type: 'TileTriggered'; tileId: string; pieceId: string; at: Coord; note: string }
  | { type: 'PieceDestroyed'; pieceId: string; at: Coord; reason?: string }
  | { type: 'AbilityUsed'; pieceId: string; abilityId: AbilityId }
  | { type: 'TurnEnded'; previous: 'white' | 'black'; next: 'white' | 'black'; turn: number }
  | { type: 'GameOver'; winner: 'white' | 'black' };

export type IllegalMoveError = {
  ok: false;
  code: 'illegal' | 'wrong_phase' | 'not_your_turn' | 'no_piece';
  message: string;
};

export type ApplySuccess = {
  ok: true;
  state: import('../match/types.js').MatchState;
  events: GameEvent[];
};

export type ApplyResult = ApplySuccess | IllegalMoveError;
