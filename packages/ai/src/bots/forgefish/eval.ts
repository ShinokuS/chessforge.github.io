import {
  getBuffedPieceIds,
  getPieceDefinition,
  getTileDef,
  isRoyalPiece,
  type MatchState,
  type PieceInstance,
  type PlayerId,
} from '@chessforge/engine';
import { featureModBonus, ROLE_VALUE, unusedAbilityValue } from '../../heuristics.js';

function opposite(side: PlayerId): PlayerId {
  return side === 'white' ? 'black' : 'white';
}

function materialHp(piece: PieceInstance): number {
  const def = getPieceDefinition(piece.defId);
  if (def.baseRole === 'king') return 0;
  const hpFactor = def.maxHp > 0 ? 0.35 + 0.65 * (piece.hp / def.maxHp) : 1;
  return (ROLE_VALUE[def.baseRole] + featureModBonus(def)) * hpFactor;
}

function statusValue(piece: PieceInstance): number {
  const def = getPieceDefinition(piece.defId);
  let value = 0;
  const frozen = piece.frozenTurns ?? 0;
  if (frozen > 0) {
    const tv = def.baseRole === 'king' ? 900 : ROLE_VALUE[def.baseRole] + featureModBonus(def);
    value -= Math.min(280, 40 + tv * 0.28) * frozen;
  }
  const shield = piece.shieldTurns ?? 0;
  if (shield > 0) value += 35 + shield * 20;
  if (def.freezeInsteadOfCapture) {
    const cooldown = piece.freezeCooldown ?? 0;
    value += cooldown > 0 ? -8 * cooldown : 25;
  }
  if (piece.windPending) value -= 12;
  if ((piece.invisibleTurns ?? 0) > 0) value += 30;
  if (piece.doubleMoveArmed) value += 95;
  if (piece.reflectAvailable && def.reflectDamageOnce) value += 32;
  if (piece.spikeArmed) value -= piece.spikeTicks >= 1 ? 200 : 80;
  return value;
}

function tileValue(state: MatchState, piece: PieceInstance): number {
  const tile = getTileDef(state.board, piece.pos);
  if (!tile) return 0;
  const def = getPieceDefinition(piece.defId);
  let value = 0;
  if (tile.spikesDoom && piece.spikeArmed) {
    value -= piece.spikeTicks >= 1 ? 220 : 90;
  }
  if (tile.movementCap) {
    const immune = tile.movementCapImmuneRoles?.includes(def.baseRole);
    if (!immune) value -= 18 + tile.movementCap * 6;
  }
  if (tile.rangeBonus && tile.rangeBonusRoles?.includes(def.baseRole)) {
    value += 12 + tile.rangeBonus * 10;
  }
  if (tile.caveGroup) value += 12;
  if (tile.forestShield) value += 8;
  if (tile.mushroomHeal && piece.hp < def.maxHp) value += 55;
  if (tile.windPush && piece.windPending) value -= 18;
  if (!tile.passable) value -= 80;
  return value;
}

function abilityResidual(piece: PieceInstance): number {
  const def = getPieceDefinition(piece.defId);
  let value = 0;
  for (const ability of def.abilities ?? []) {
    const cooldown = piece.abilityCooldowns[ability.id] ?? 0;
    if (ability.cooldownTurns !== undefined) {
      value += cooldown === 0 ? unusedAbilityValue() * 0.65 : -cooldown * 5;
    } else if (!piece.abilitiesUsed[ability.id]) {
      value += unusedAbilityValue();
    }
  }
  if (def.doubleMoveOnce && !piece.abilitiesUsed.doubleMove) value += 50;
  return value;
}

function pst(state: MatchState, piece: PieceInstance): number {
  const def = getPieceDefinition(piece.defId);
  const cx = (state.board.width - 1) / 2;
  const cy = (state.board.height - 1) / 2;
  const distance = Math.abs(piece.pos.x - cx) + Math.abs(piece.pos.y - cy);
  const center = Math.max(0, 5 - distance) * (def.baseRole === 'pawn' ? 2.4 : 2);
  const progress =
    piece.owner === 'white'
      ? piece.pos.y / Math.max(1, state.board.height - 1)
      : (state.board.height - 1 - piece.pos.y) / Math.max(1, state.board.height - 1);
  return center + (def.baseRole === 'pawn' ? progress * 18 : progress * 4);
}

function royalPressure(state: MatchState, side: PlayerId): number {
  let pressure = 0;
  const enemy = opposite(side);
  for (const royal of state.pieces) {
    if (royal.owner !== side || !isRoyalPiece(royal)) continue;
    for (const piece of state.pieces) {
      if (piece.owner !== enemy || isRoyalPiece(piece)) continue;
      const distance = Math.max(
        Math.abs(piece.pos.x - royal.pos.x),
        Math.abs(piece.pos.y - royal.pos.y),
      );
      if (distance <= 1) pressure += 55;
      else if (distance === 2) pressure += 18;
    }
  }
  return pressure;
}

/** Fast: material×HP + center (LMR / pre-prune). */
export function evaluateFast(state: MatchState, perspective: PlayerId): number {
  if (state.phase === 'gameOver') {
    if (state.winner === perspective) return 1_000_000;
    if (state.winner && state.winner !== perspective) return -1_000_000;
    return 0;
  }
  let white = 0;
  let black = 0;
  for (const piece of state.pieces) {
    const v = materialHp(piece) + pst(state, piece);
    if (piece.owner === 'white') white += v;
    else black += v;
  }
  return perspective === 'white' ? white - black : black - white;
}

/**
 * Mid: + statuses, tiles, ability residual, royal proximity — no movegen.
 * Default leaf for Forgefish.
 */
export function evaluateMid(state: MatchState, perspective: PlayerId): number {
  if (state.phase === 'gameOver') {
    if (state.winner === perspective) return 1_000_000;
    if (state.winner && state.winner !== perspective) return -1_000_000;
    return 0;
  }

  let white = 0;
  let black = 0;
  const buffed = getBuffedPieceIds(state);
  for (const piece of state.pieces) {
    let v =
      materialHp(piece) +
      statusValue(piece) * 0.9 +
      tileValue(state, piece) * 0.85 +
      abilityResidual(piece) * 0.9 +
      pst(state, piece);
    if (buffed.has(piece.id)) v += 40;
    if (piece.owner === 'white') white += v;
    else black += v;
  }

  white -= royalPressure(state, 'white');
  black -= royalPressure(state, 'black');

  return perspective === 'white' ? white - black : black - white;
}
