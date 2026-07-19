import {
  getBuffedPieceIds,
  getLegalMoves,
  getPieceDefinition,
  getTileDef,
  type MatchState,
  type PieceInstance,
  type PlayerId,
} from '@chessforge/engine';
import {
  ROLE_VALUE,
  featureModBonus,
  unusedAbilityValue,
} from './heuristics.js';

function pieceMaterial(piece: PieceInstance): number {
  const def = getPieceDefinition(piece.defId);
  const base = ROLE_VALUE[def.baseRole];
  const mod = featureModBonus(def);
  // Low HP is more than linear loss (easier to finish).
  const hpFactor =
    def.maxHp > 0 ? 0.35 + 0.65 * (piece.hp / def.maxHp) : 1;
  return (base + mod) * hpFactor;
}

function statusTerms(piece: PieceInstance, perspective: PlayerId): number {
  const mine = piece.owner === perspective;
  let score = 0;
  const frozen = piece.frozenTurns ?? 0;
  if (frozen > 0) {
    const v = Math.min(280, 40 + pieceTacticalValue(piece.defId) * 0.28) * frozen;
    score += mine ? -v : v;
  }
  const shield = piece.shieldTurns ?? 0;
  if (shield > 0) {
    const v = 35 + shield * 20;
    score += mine ? v : -v;
  }
  const cd = piece.freezeCooldown ?? 0;
  const def = getPieceDefinition(piece.defId);
  if (def.freezeInsteadOfCapture && mine) {
    score += cd > 0 ? -8 * cd : 25;
  }
  if (piece.windPending) {
    score += mine ? -12 : 12;
  }
  return score;
}

/** Tile scoring from definition flags — any new tile with these flags is understood. */
function tileTerms(piece: PieceInstance, perspective: PlayerId, state: MatchState): number {
  const tile = getTileDef(state.board, piece.pos);
  if (!tile) return 0;
  const mine = piece.owner === perspective;
  let score = 0;
  const def = getPieceDefinition(piece.defId);

  if (tile.spikesDoom && piece.spikeArmed) {
    const urgency = piece.spikeTicks >= 1 ? 220 : 90;
    score += mine ? -urgency : urgency;
  }
  if (tile.movementCap && mine) {
    const immune = tile.movementCapImmuneRoles?.includes(def.baseRole);
    if (!immune) score -= 18 + tile.movementCap * 6;
  }
  if (tile.rangeBonus && mine && tile.rangeBonusRoles?.includes(def.baseRole)) {
    score += 12 + tile.rangeBonus * 10;
  }
  if (tile.caveGroup && mine) score += 12;
  if (tile.forestShield && mine) score += 8;
  if (tile.mushroomHeal && mine) score += 55;
  if (tile.windPush && mine && piece.windPending) score -= 18;
  if (tile.passable === false) score += mine ? -80 : 80;

  return score;
}

function captureTargets(state: MatchState, side: PlayerId): Map<string, number> {
  const probe: MatchState = {
    ...state,
    activePlayer: side,
  };
  const map = new Map<string, number>();
  for (const m of getLegalMoves(probe)) {
    if (!m.captures || !m.targetPieceId) continue;
    const key = `${m.to.x},${m.to.y}`;
    const target = state.pieces.find((p) => p.id === m.targetPieceId);
    const val = target ? pieceTacticalValue(target.defId) : 100;
    const prev = map.get(key) ?? 0;
    if (val > prev) map.set(key, val);
  }
  return map;
}

function hangingTerms(state: MatchState, perspective: PlayerId): number {
  if (state.pieces.length > 20) return 0;

  const opp: PlayerId = perspective === 'white' ? 'black' : 'white';
  const attackedByOpp = captureTargets(state, opp);
  const attackedByMe = captureTargets(state, perspective);
  let score = 0;

  for (const p of state.pieces) {
    const def = getPieceDefinition(p.defId);
    if (def.baseRole === 'king') continue;
    const key = `${p.pos.x},${p.pos.y}`;
    const threat = attackedByOpp.get(key);
    if (p.owner === perspective && threat !== undefined) {
      const defended = attackedByMe.has(key);
      const val = pieceTacticalValue(p.defId);
      score -= defended ? val * 0.15 : val * 0.55;
      if ((p.shieldTurns ?? 0) > 0) score += val * 0.4;
    }
    if (p.owner !== perspective && threat === undefined) {
      const myThreat = attackedByMe.get(key);
      if (myThreat !== undefined) {
        score += Math.min(80, pieceTacticalValue(p.defId) * 0.12);
      }
    }
  }
  return score;
}

/**
 * Static evaluation from `perspective`'s point of view (higher = better for them).
 * Scale ≈ centipawns (pawn = 100). Feature-driven — no piece/tile id tables.
 */
export function evaluate(state: MatchState, perspective: PlayerId): number {
  if (state.phase === 'gameOver') {
    if (state.winner === perspective) return 1_000_000;
    if (state.winner && state.winner !== perspective) return -1_000_000;
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
    score += statusTerms(piece, perspective);

    const def = getPieceDefinition(piece.defId);
    if (piece.owner === perspective && def.abilities) {
      for (const ab of def.abilities) {
        if (!piece.abilitiesUsed[ab.id]) {
          score += unusedAbilityValue();
        }
      }
    }

    if (buffed.has(piece.id)) {
      score += piece.owner === perspective ? 40 : -40;
    }

    if (piece.owner === perspective) {
      const dist = Math.abs(piece.pos.x - cx) + Math.abs(piece.pos.y - cy);
      score += Math.max(0, 5 - dist) * 2;
    }
  }

  score += hangingTerms(state, perspective);

  {
    const opp: PlayerId = perspective === 'white' ? 'black' : 'white';
    const attacks = captureTargets(state, opp);
    for (const p of state.pieces) {
      if (p.owner !== perspective) continue;
      if (getPieceDefinition(p.defId).baseRole !== 'king') continue;
      if (attacks.has(`${p.pos.x},${p.pos.y}`)) {
        score -= 800;
      }
    }
  }

  for (const piece of state.pieces) {
    if (piece.owner !== perspective) continue;
    const def = getPieceDefinition(piece.defId);
    if (!def.freezeInsteadOfCapture || (piece.freezeCooldown ?? 0) > 0) continue;
    const range = def.freezeRange ?? 3;
    for (const enemy of state.pieces) {
      if (enemy.owner === perspective) continue;
      if ((enemy.shieldTurns ?? 0) > 0) continue;
      const enemyDef = getPieceDefinition(enemy.defId);
      if (enemyDef.baseRole === 'king') continue;
      const dist = Math.max(
        Math.abs(enemy.pos.x - piece.pos.x),
        Math.abs(enemy.pos.y - piece.pos.y),
      );
      if (dist <= range) {
        score += Math.min(120, pieceTacticalValue(enemy.defId) * 0.12);
      }
    }
  }

  if (state.activePlayer === perspective && state.pieces.length <= 18) {
    score += Math.min(40, getLegalMoves(state).length) * 1.2;
  }

  return score;
}

export function pieceTacticalValue(defId: string): number {
  const def = getPieceDefinition(defId);
  return ROLE_VALUE[def.baseRole] + featureModBonus(def);
}
