import {
  getPieceDefinition,
  isRoyalPiece,
  type GameCommand,
  type LegalMove,
  type MatchState,
} from '@chessforge/engine';
import { pieceTacticalValue } from '../evaluate.js';
import { moveKey, moveToCommand } from './model.js';

export type Candidate = {
  command: GameCommand;
  key: string;
  move: LegalMove | null;
  tactical: boolean;
};

export type OrderingState = {
  killers: Array<[string | null, string | null]>;
  history: Map<string, number>;
  counterMoves: Map<string, string>;
};

export function candidates(state: MatchState, moves: LegalMove[]): Candidate[] {
  const result: Candidate[] = new Array(moves.length + (state.extraMovePieceId ? 1 : 0));
  for (let i = 0; i < moves.length; i += 1) {
    const move = moves[i]!;
    result[i] = {
      command: moveToCommand(move),
      key: moveKey(move),
      move,
      tactical: Boolean(move.captures || move.abilityId || move.push),
    };
  }
  if (state.extraMovePieceId) {
    result[moves.length] = {
      command: { type: 'endTurn' },
      key: 'endTurn',
      move: null,
      tactical: false,
    };
  }
  return result;
}

function tacticalScore(
  move: LegalMove,
  byId: Map<string, MatchState['pieces'][number]>,
  bySq: Map<string, MatchState['pieces'][number]>,
): number {
  let score = move.captures ? 20_000 : 0;
  if (move.captures && move.targetPieceId) {
    const victim = byId.get(move.targetPieceId);
    const attacker = bySq.get(`${move.from.x},${move.from.y}`);
    if (victim && isRoyalPiece(victim)) return 5_000_000;
    const victimValue = victim ? pieceTacticalValue(victim.defId) : 100;
    const attackerValue = attacker ? pieceTacticalValue(attacker.defId) : 100;
    const attackerDef = attacker ? getPieceDefinition(attacker.defId) : null;
    const dealt = victim && attackerDef
      ? Math.min(victim.hp, Math.max(0, attackerDef.attack))
      : 1;
    const hpFraction = victim ? dealt / Math.max(1, victim.hp) : 1;
    const lethal = victim ? dealt >= victim.hp : true;
    score += Math.floor(victimValue * (lethal ? 16 : 7 * hpFraction));
    score -= Math.floor(attackerValue * (lethal ? 0.125 : 0.25));
    if (attackerDef?.freezeInsteadOfCapture) score += 800;
  }
  if (move.abilityId) score += 700;
  if (move.push) score += 350;
  return score;
}

type Scored = { candidate: Candidate; index: number; score: number };

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
  const byId = new Map(state.pieces.map((p) => [p.id, p]));
  const bySq = new Map(state.pieces.map((p) => [`${p.pos.x},${p.pos.y}`, p]));
  const scored: Scored[] = new Array(list.length);
  for (let i = 0; i < list.length; i += 1) {
    const candidate = list[i]!;
    let score = 0;
    if (candidate.key === ttMove) score += 10_000_000;
    if (candidate.move) score += tacticalScore(candidate.move, byId, bySq);
    if (!candidate.tactical) {
      if (candidate.key === killers[0]) score += 9_000;
      else if (candidate.key === killers[1]) score += 7_000;
      if (candidate.key === counter) score += 8_000;
      score += ordering.history.get(candidate.key) ?? 0;
    }
    scored[i] = { candidate, index: i, score };
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  for (let i = 0; i < scored.length; i += 1) {
    list[i] = scored[i]!.candidate;
  }
  return list;
}

export function recordCutoff(
  ordering: OrderingState,
  candidate: Candidate,
  ply: number,
  depth: number,
  previousMove: string | null,
): void {
  if (candidate.tactical) return;
  const slot = ordering.killers[ply] ?? (ordering.killers[ply] = [null, null]);
  if (slot[0] !== candidate.key) {
    slot[1] = slot[0];
    slot[0] = candidate.key;
  }
  ordering.history.set(
    candidate.key,
    (ordering.history.get(candidate.key) ?? 0) + depth * depth,
  );
  if (previousMove) ordering.counterMoves.set(previousMove, candidate.key);
}
