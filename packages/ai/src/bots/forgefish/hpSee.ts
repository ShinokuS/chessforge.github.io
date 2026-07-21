import {
  getPieceDefinition,
  isRoyalPiece,
  type LegalMove,
  type MatchState,
  type PieceInstance,
} from '@chessforge/engine';
import { featureModBonus, ROLE_VALUE } from '../../heuristics.js';

function pieceValue(piece: PieceInstance): number {
  const def = getPieceDefinition(piece.defId);
  if (isRoyalPiece(piece) || def.baseRole === 'king') return 900;
  const full = ROLE_VALUE[def.baseRole] + featureModBonus(def);
  const hpFrac = def.maxHp > 0 ? Math.min(1, 0.35 + 0.65 * (piece.hp / def.maxHp)) : 1;
  return Math.max(40, full * hpFrac);
}

/**
 * HP-aware Static Exchange Evaluation for a capture/hit/freeze/push on a square.
 * Positive = good for the side to move that just played `move`.
 */
export function hpSee(state: MatchState, move: LegalMove): number {
  if (!move.captures && !move.push && move.abilityId !== 'curseEnemy') {
    if (move.abilityId) return abilitySeeHint(state, move);
    return 0;
  }

  const bySq = new Map(state.pieces.map((p) => [`${p.pos.x},${p.pos.y}`, p]));
  const attacker = bySq.get(`${move.from.x},${move.from.y}`);
  if (!attacker) return 0;
  const attackerDef = getPieceDefinition(attacker.defId);

  if (move.push) {
    return 60 + Math.min(120, pieceValue(attacker) * 0.08);
  }

  const victim = move.targetPieceId
    ? state.pieces.find((p) => p.id === move.targetPieceId)
    : bySq.get(`${move.to.x},${move.to.y}`);
  if (!victim) return move.captures ? 80 : 0;

  if ((victim.shieldTurns ?? 0) > 0) return -40;

  if (attackerDef.freezeInsteadOfCapture) {
    const tempo = isRoyalPiece(victim) ? 420 : Math.min(280, pieceValue(victim) * 0.35);
    return tempo;
  }

  if (isRoyalPiece(victim)) return 50_000;

  const attack = Math.max(0, attackerDef.attack);
  const dealt = Math.min(victim.hp, attack);
  const lethal = dealt >= victim.hp;
  const victimVal = pieceValue(victim);
  const gain = lethal
    ? victimVal
    : victimVal * (dealt / Math.max(1, victim.hp));

  // Recapture risk: cheapest enemy that can attack `to` roughly.
  let recapture = 0;
  const stm = state.activePlayer;
  for (const enemy of state.pieces) {
    if (enemy.owner === stm) continue;
    if ((enemy.frozenTurns ?? 0) > 0) continue;
    const edef = getPieceDefinition(enemy.defId);
    if (edef.immobile || edef.cannotCapture) continue;
    const dx = Math.abs(enemy.pos.x - move.to.x);
    const dy = Math.abs(enemy.pos.y - move.to.y);
    const cheb = Math.max(dx, dy);
    if (cheb <= 1 || (edef.baseRole === 'knight' && dx * dy === 2)) {
      recapture = Math.max(recapture, Math.min(pieceValue(attacker), pieceValue(enemy) * 0.5));
    }
  }

  if (lethal) return gain - recapture * 0.35;
  return gain - recapture * 0.15 - pieceValue(attacker) * 0.05;
}

function abilitySeeHint(state: MatchState, move: LegalMove): number {
  const id = move.abilityId;
  if (!id) return 0;
  if (id === 'blessHeal' || id === 'grantShield' || id === 'judgeBless' || id === 'frontBless') {
    const target = move.targetPieceId
      ? state.pieces.find((p) => p.id === move.targetPieceId)
      : null;
    if (target && isRoyalPiece(target)) return 220;
    return 90;
  }
  if (id === 'abdicate' || id === 'designatePromote') return 150;
  if (id === 'heartEat') {
    const target = move.targetPieceId
      ? state.pieces.find((p) => p.id === move.targetPieceId)
      : null;
    return target ? Math.max(80, (target.hp - 1) * 70) : 80;
  }
  if (id === 'throwSpear') return 140;
  if (id === 'spikeTile') return 70;
  if (id === 'retreat' || id === 'royalWarp' || id === 'allyLeap' || id === 'allySwap') {
    return 40;
  }
  return 50;
}

/** Gate for quiescence: keep move if tactically interesting. */
export function qsearchWorthy(state: MatchState, move: LegalMove, standPat: number, alpha: number): boolean {
  if (move.captures || move.push) {
    const see = hpSee(state, move);
    if (see < -60 && standPat + see + 40 <= alpha) return false;
    return see > -80 || Boolean(move.captures);
  }
  if (move.abilityId) {
    return hpSee(state, move) >= 80;
  }
  return false;
}
