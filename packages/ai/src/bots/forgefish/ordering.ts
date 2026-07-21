import {
  getPieceDefinition,
  isRoyalPiece,
  type GameCommand,
  type LegalMove,
  type MatchState,
} from '@chessforge/engine';
import { moveKey, moveToCommand } from '../../search/model.js';
import type { OrderingState } from '../../search/ordering.js';
import { hpSee } from './hpSee.js';

export type Candidate = {
  command: GameCommand;
  key: string;
  move: LegalMove | null;
  tactical: boolean;
};

export function candidates(state: MatchState, moves: LegalMove[], dpaEndTurn: boolean): Candidate[] {
  const extra = state.extraMovePieceId || dpaEndTurn ? 1 : 0;
  const result: Candidate[] = new Array(moves.length + extra);
  for (let i = 0; i < moves.length; i += 1) {
    const move = moves[i]!;
    result[i] = {
      command: moveToCommand(move),
      key: moveKey(move),
      move,
      tactical: Boolean(move.captures || move.abilityId || move.push),
    };
  }
  if (extra) {
    result[moves.length] = {
      command: { type: 'endTurn' },
      key: 'endTurn',
      move: null,
      tactical: dpaEndTurn && !state.extraMovePieceId,
    };
  }
  return result;
}

export function orderCandidates(
  state: MatchState,
  list: Candidate[],
  ordering: OrderingState,
  ply: number,
  ttMove: string | null,
  previousMove: string | null,
): Candidate[] {
  const killers = ordering.killers[ply] ?? [null, null];
  const counter = previousMove ? ordering.counterMoves.get(previousMove) : null;
  const scored: Array<{ candidate: Candidate; index: number; score: number }> = new Array(
    list.length,
  );
  for (let i = 0; i < list.length; i += 1) {
    const candidate = list[i]!;
    let score = 0;
    if (candidate.key === ttMove) score += 10_000_000;
    if (candidate.move) {
      const see = hpSee(state, candidate.move);
      if (candidate.move.captures || candidate.move.push) {
        score += 20_000 + see * 16;
        const victim = candidate.move.targetPieceId
          ? state.pieces.find((p) => p.id === candidate.move!.targetPieceId)
          : null;
        if (victim && isRoyalPiece(victim)) score += 5_000_000;
      } else if (candidate.move.abilityId) {
        score += 700 + see * 8;
      }
      const attacker = state.pieces.find(
        (p) => p.pos.x === candidate.move!.from.x && p.pos.y === candidate.move!.from.y,
      );
      if (attacker) {
        const def = getPieceDefinition(attacker.defId);
        if (def.freezeInsteadOfCapture && candidate.move.captures) score += 400;
      }
    }
    if (!candidate.tactical) {
      if (candidate.key === killers[0]) score += 9_000;
      else if (candidate.key === killers[1]) score += 7_000;
      if (candidate.key === counter) score += 8_000;
      score += ordering.history.get(candidate.key) ?? 0;
    }
    if (candidate.key === 'endTurn' && candidate.tactical) score += 1_500;
    scored[i] = { candidate, index: i, score };
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.candidate);
}

export { recordCutoff } from '../../search/ordering.js';
export type { OrderingState } from '../../search/ordering.js';
