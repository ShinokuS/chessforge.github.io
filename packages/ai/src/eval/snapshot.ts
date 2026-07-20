import {
  getBuffedPieceIds,
  getLegalMoves,
  getPieceDefinition,
  getTileDef,
  isRoyalPiece,
  type MatchState,
  type PieceInstance,
  type PlayerId,
} from '@chessforge/engine';
import { ROLE_VALUE, featureModBonus, unusedAbilityValue } from '../heuristics.js';
import { evaluationStateKey, evaluationStateSignature } from './key.js';
import { accumulateCaptureThreats } from './threats.js';
import type {
  EvaluationFeatures,
  EvaluationSnapshot,
  MoveSnapshot,
  SideValues,
} from './types.js';

const SIDES: ReadonlyArray<PlayerId> = ['white', 'black'];
const SNAPSHOT_CACHE_LIMIT = 2_048;

type CacheEntry = {
  signature: string;
  snapshot: EvaluationSnapshot;
};

const snapshotCache = new Map<string, CacheEntry>();

function sideValues(): SideValues {
  return { white: 0, black: 0 };
}

function squareKey(x: number, y: number): string {
  return `${x},${y}`;
}

function tacticalValue(piece: PieceInstance): number {
  const def = getPieceDefinition(piece.defId);
  if (def.baseRole === 'king') return 900;
  return ROLE_VALUE[def.baseRole] + featureModBonus(def);
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
    value -= Math.min(280, 40 + tacticalValue(piece) * 0.28) * frozen;
  }
  const shield = piece.shieldTurns ?? 0;
  if (shield > 0) value += 35 + shield * 20;
  if (def.freezeInsteadOfCapture) {
    const cooldown = piece.freezeCooldown ?? 0;
    value += cooldown > 0 ? -8 * cooldown : 25;
  }
  if (piece.windPending) value -= 12;
  if ((piece.invisibleTurns ?? 0) > 0) {
    value += 30 + Math.min(70, tacticalValue(piece) * 0.08);
  }
  if (piece.doubleMoveArmed) value += 95;
  if (piece.reflectAvailable && def.reflectDamageOnce) value += 32;
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

function abilityValue(piece: PieceInstance): number {
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

function pieceSquareValue(state: MatchState, piece: PieceInstance): number {
  const def = getPieceDefinition(piece.defId);
  const cx = (state.board.width - 1) / 2;
  const cy = (state.board.height - 1) / 2;
  const distance = Math.abs(piece.pos.x - cx) + Math.abs(piece.pos.y - cy);
  const center = Math.max(0, 5 - distance) * (def.baseRole === 'pawn' ? 2.4 : 2);
  const progress =
    piece.owner === 'white'
      ? piece.pos.y / Math.max(1, state.board.height - 1)
      : (state.board.height - 1 - piece.pos.y) / Math.max(1, state.board.height - 1);
  const advancement = def.baseRole === 'pawn' ? progress * 18 : progress * 4;
  return center + advancement;
}

function moveSnapshot(state: MatchState, side: PlayerId): MoveSnapshot {
  const probe: MatchState = {
    ...state,
    activePlayer: side,
    extraMovePieceId:
      state.activePlayer === side ? (state.extraMovePieceId ?? null) : null,
  };
  const moves = getLegalMoves(probe);
  const captures = new Map<string, number>();
  const lethalCaptures = new Map<string, number>();
  const captureDamage = new Map<string, number>();
  const minAttackerValue = new Map<string, number>();
  const piecesById = new Map(state.pieces.map((piece) => [piece.id, piece]));
  const piecesBySquare = new Map(
    state.pieces.map((piece) => [squareKey(piece.pos.x, piece.pos.y), piece]),
  );

  for (const move of moves) {
    if (!move.captures || !move.targetPieceId) continue;
    const target = piecesById.get(move.targetPieceId);
    const value = target ? tacticalValue(target) : 100;
    const key = squareKey(move.to.x, move.to.y);
    captures.set(key, Math.max(captures.get(key) ?? 0, value));

    const mover = piecesBySquare.get(squareKey(move.from.x, move.from.y));
    if (!mover || !target) continue;
    const moverDef = getPieceDefinition(mover.defId);
    const moverValue = tacticalValue(mover);
    const prevMin = minAttackerValue.get(key);
    if (prevMin === undefined || moverValue < prevMin) {
      minAttackerValue.set(key, moverValue);
    }
    if (!moverDef.freezeInsteadOfCapture && moverDef.attack > 0) {
      captureDamage.set(key, Math.max(captureDamage.get(key) ?? 0, moverDef.attack));
    }
    if (
      !moverDef.freezeInsteadOfCapture &&
      moverDef.attack > 0 &&
      (target.shieldTurns ?? 0) === 0 &&
      target.hp - moverDef.attack <= 0
    ) {
      lethalCaptures.set(
        key,
        Math.max(lethalCaptures.get(key) ?? 0, tacticalValue(target)),
      );
    }
  }

  return {
    moves,
    captures,
    lethalCaptures,
    captureDamage,
    minAttackerValue,
    mobility: Math.min(48, moves.length),
  };
}

function addThreatFeatures(
  state: MatchState,
  moves: Record<PlayerId, MoveSnapshot>,
  features: EvaluationFeatures,
): void {
  accumulateCaptureThreats(state, moves, features.threats);

  for (const freezer of state.pieces) {
    const def = getPieceDefinition(freezer.defId);
    if (!def.freezeInsteadOfCapture || (freezer.freezeCooldown ?? 0) > 0) continue;
    const range = def.freezeRange ?? 3;
    for (const target of state.pieces) {
      if (
        target.owner === freezer.owner ||
        isRoyalPiece(target) ||
        (target.shieldTurns ?? 0) > 0
      ) {
        continue;
      }
      const distance = Math.max(
        Math.abs(target.pos.x - freezer.pos.x),
        Math.abs(target.pos.y - freezer.pos.y),
      );
      if (distance <= range) {
        features.threats[freezer.owner] += Math.min(120, tacticalValue(target) * 0.12);
      }
    }
  }
}

function addRoyalSafety(
  state: MatchState,
  moves: Record<PlayerId, MoveSnapshot>,
  features: EvaluationFeatures,
): void {
  for (const side of SIDES) {
    const enemy: PlayerId = side === 'white' ? 'black' : 'white';
    const royals = state.pieces.filter((piece) => piece.owner === side && isRoyalPiece(piece));
    if (royals.length === 0) {
      features.royalSafety[side] -= 1_000_000;
      continue;
    }

    for (const royal of royals) {
      const key = squareKey(royal.pos.x, royal.pos.y);
      if (moves[enemy].lethalCaptures.has(key)) {
        features.royalSafety[side] -= 75_000;
        continue;
      }

      let pressure = 0;
      for (const piece of state.pieces) {
        if (piece.owner !== enemy || isRoyalPiece(piece)) continue;
        const distance = Math.max(
          Math.abs(piece.pos.x - royal.pos.x),
          Math.abs(piece.pos.y - royal.pos.y),
        );
        if (distance <= 1) pressure += 55;
        else if (distance === 2) pressure += 18;
      }
      let covered = 0;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (dx === 0 && dy === 0) continue;
          const x = royal.pos.x + dx;
          const y = royal.pos.y + dy;
          if (x < 0 || y < 0 || x >= state.board.width || y >= state.board.height) continue;
          if (moves[enemy].lethalCaptures.has(squareKey(x, y))) covered += 1;
        }
      }
      features.royalSafety[side] -= pressure + covered * 28;
    }
  }
}

function buildSnapshot(state: MatchState): EvaluationSnapshot {
  const features: EvaluationFeatures = {
    materialHp: sideValues(),
    status: sideValues(),
    tiles: sideValues(),
    abilities: sideValues(),
    pieceSquare: sideValues(),
    threats: sideValues(),
    royalSafety: sideValues(),
  };
  const buffed = getBuffedPieceIds(state);
  let phaseMaterial = 0;

  for (const piece of state.pieces) {
    const side = piece.owner;
    const def = getPieceDefinition(piece.defId);
    features.materialHp[side] += materialHp(piece);
    features.status[side] += statusValue(piece);
    features.tiles[side] += tileValue(state, piece);
    features.abilities[side] += abilityValue(piece);
    features.pieceSquare[side] += pieceSquareValue(state, piece);
    if (buffed.has(piece.id)) features.status[side] += 40;
    if (def.baseRole !== 'king' && def.baseRole !== 'pawn') {
      phaseMaterial += ROLE_VALUE[def.baseRole] + featureModBonus(def);
    }
  }

  const moves: Record<PlayerId, MoveSnapshot> = {
    white: moveSnapshot(state, 'white'),
    black: moveSnapshot(state, 'black'),
  };
  const royalSquares: Record<PlayerId, ReadonlyArray<string>> = {
    white: state.pieces
      .filter((piece) => piece.owner === 'white' && isRoyalPiece(piece))
      .map((piece) => squareKey(piece.pos.x, piece.pos.y)),
    black: state.pieces
      .filter((piece) => piece.owner === 'black' && isRoyalPiece(piece))
      .map((piece) => squareKey(piece.pos.x, piece.pos.y)),
  };

  addThreatFeatures(state, moves, features);
  addRoyalSafety(state, moves, features);

  return {
    phase: Math.max(0, Math.min(1, phaseMaterial / 6_400)),
    features,
    moves,
    royalSquares,
  };
}

export function getEvaluationSnapshot(state: MatchState): EvaluationSnapshot {
  const signature = evaluationStateSignature(state);
  const key = evaluationStateKey(signature);
  const cached = snapshotCache.get(key);
  if (cached?.signature === signature) {
    snapshotCache.delete(key);
    snapshotCache.set(key, cached);
    return cached.snapshot;
  }

  const snapshot = buildSnapshot(state);
  snapshotCache.set(key, { signature, snapshot });
  if (snapshotCache.size > SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = snapshotCache.keys().next().value;
    if (oldestKey !== undefined) snapshotCache.delete(oldestKey);
  }
  return snapshot;
}

export function clearEvaluationSnapshotCache(): void {
  snapshotCache.clear();
}
