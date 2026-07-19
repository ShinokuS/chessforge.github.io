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

function opposite(p: PlayerId): PlayerId {
  return p === 'white' ? 'black' : 'white';
}

function isKing(piece: PieceInstance): boolean {
  return getPieceDefinition(piece.defId).baseRole === 'king';
}

function pieceMaterial(piece: PieceInstance): number {
  const def = getPieceDefinition(piece.defId);
  // Kings cancel when both alive; game-over handles missing kings.
  if (def.baseRole === 'king') return 0;
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

/**
 * Squares `side` can capture onto. Includes freeze-"captures".
 */
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

/**
 * Lethal captures only (HP damage that would remove the piece). Freeze ≠ kill.
 * This is what matters for king-mate threats in Chessforge.
 */
function lethalCaptureTargets(state: MatchState, side: PlayerId): Map<string, number> {
  const probe: MatchState = {
    ...state,
    activePlayer: side,
  };
  const map = new Map<string, number>();
  for (const m of getLegalMoves(probe)) {
    if (!m.captures || !m.targetPieceId) continue;
    const mover = state.pieces.find(
      (p) => p.pos.x === m.from.x && p.pos.y === m.from.y,
    );
    if (!mover) continue;
    const mdef = getPieceDefinition(mover.defId);
    if (mdef.freezeInsteadOfCapture) continue;
    if (mdef.attack <= 0) continue;
    const target = state.pieces.find((p) => p.id === m.targetPieceId);
    if (!target || (target.shieldTurns ?? 0) > 0) continue;
    if (target.hp - mdef.attack > 0) continue;
    const key = `${m.to.x},${m.to.y}`;
    const val = pieceTacticalValue(target.defId);
    const prev = map.get(key) ?? 0;
    if (val > prev) map.set(key, val);
  }
  return map;
}

function findKing(state: MatchState, side: PlayerId): PieceInstance | null {
  return state.pieces.find((p) => p.owner === side && isKing(p)) ?? null;
}

/** True if `side`'s king can be lethally captured by the opponent right now. */
export function isKingEnPrise(state: MatchState, side: PlayerId): boolean {
  const king = findKing(state, side);
  if (!king) return false;
  const threats = lethalCaptureTargets(state, opposite(side));
  return threats.has(`${king.pos.x},${king.pos.y}`);
}

/**
 * King safety: en-prise king is nearly lost (must resolve this turn).
 * Also penalize pressure around the king so mating nets show up before M1.
 */
function kingSafetyTerms(state: MatchState, perspective: PlayerId): number {
  let score = 0;
  const opp = opposite(perspective);
  const myKing = findKing(state, perspective);
  const theirKing = findKing(state, opp);
  const lethalByOpp = lethalCaptureTargets(state, opp);
  const lethalByMe = lethalCaptureTargets(state, perspective);

  if (myKing) {
    const key = `${myKing.pos.x},${myKing.pos.y}`;
    if (lethalByOpp.has(key)) {
      // Nearly mate — only quieter than actual gameOver so search still prefers faster mates.
      score -= 75_000;
    } else {
      // Soft pressure: enemy pieces that can step adjacent / aim at king zone.
      let pressure = 0;
      for (const enemy of state.pieces) {
        if (enemy.owner !== opp || isKing(enemy)) continue;
        const dist = Math.max(
          Math.abs(enemy.pos.x - myKing.pos.x),
          Math.abs(enemy.pos.y - myKing.pos.y),
        );
        if (dist <= 1) pressure += 55;
        else if (dist === 2) pressure += 18;
      }
      // Count how many of our escape/adjacent squares are covered.
      let covered = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const x = myKing.pos.x + dx;
          const y = myKing.pos.y + dy;
          if (x < 0 || y < 0 || x >= state.board.width || y >= state.board.height) continue;
          if (lethalByOpp.has(`${x},${y}`)) covered += 1;
        }
      }
      score -= pressure + covered * 28;
    }
  } else {
    score -= 1_000_000;
  }

  if (theirKing) {
    const key = `${theirKing.pos.x},${theirKing.pos.y}`;
    if (lethalByMe.has(key)) {
      score += 75_000;
    } else {
      let pressure = 0;
      for (const mine of state.pieces) {
        if (mine.owner !== perspective || isKing(mine)) continue;
        const dist = Math.max(
          Math.abs(mine.pos.x - theirKing.pos.x),
          Math.abs(mine.pos.y - theirKing.pos.y),
        );
        if (dist <= 1) pressure += 55;
        else if (dist === 2) pressure += 18;
      }
      score += pressure;
    }
  } else {
    score += 1_000_000;
  }

  return score;
}

function hangingTerms(state: MatchState, perspective: PlayerId): number {
  const opp = opposite(perspective);
  const attackedByOpp = captureTargets(state, opp);
  const attackedByMe = captureTargets(state, perspective);
  let score = 0;

  for (const p of state.pieces) {
    if (isKing(p)) continue;
    const key = `${p.pos.x},${p.pos.y}`;
    const threat = attackedByOpp.get(key);
    if (p.owner === perspective && threat !== undefined) {
      const defended = attackedByMe.has(key);
      const val = pieceTacticalValue(p.defId);
      score -= defended ? val * 0.22 : val * 0.72;
      if ((p.shieldTurns ?? 0) > 0) score += val * 0.45;
    }
    if (p.owner !== perspective && threat === undefined) {
      const myThreat = attackedByMe.get(key);
      if (myThreat !== undefined) {
        score += Math.min(110, pieceTacticalValue(p.defId) * 0.16);
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
    if (def.abilities) {
      for (const ab of def.abilities) {
        if (!piece.abilitiesUsed[ab.id]) {
          const v = unusedAbilityValue();
          score += piece.owner === perspective ? v : -v;
        }
      }
    }

    if (buffed.has(piece.id)) {
      score += piece.owner === perspective ? 40 : -40;
    }

    const dist = Math.abs(piece.pos.x - cx) + Math.abs(piece.pos.y - cy);
    const center = Math.max(0, 5 - dist) * 2;
    score += piece.owner === perspective ? center : -center;
  }

  score += hangingTerms(state, perspective);
  score += kingSafetyTerms(state, perspective);

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

  if (state.activePlayer === perspective && state.pieces.length <= 24) {
    score += Math.min(48, getLegalMoves(state).length) * 1.15;
  }

  return score;
}

export function pieceTacticalValue(defId: string): number {
  const def = getPieceDefinition(defId);
  if (def.baseRole === 'king') return 900; // tactical compare only; not material
  return ROLE_VALUE[def.baseRole] + featureModBonus(def);
}
