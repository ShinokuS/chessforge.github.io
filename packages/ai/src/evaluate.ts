import {
  getBuffedPieceIds,
  getPieceDefinition,
  getTileDef,
  isRoyalPiece,
  type MatchState,
  type PieceInstance,
  type PlayerId,
} from '@chessforge/engine';
import { ROLE_VALUE, featureModBonus, unusedAbilityValue } from './heuristics.js';
import { scoreSnapshot } from './eval/score.js';
import { getEvaluationSnapshot } from './eval/snapshot.js';
import { buildCaptureMaps, threatScoreForPerspective } from './eval/threats.js';

function opposite(side: PlayerId): PlayerId {
  return side === 'white' ? 'black' : 'white';
}

/**
 * Static evaluation from `perspective`'s point of view (higher = better).
 * Expensive state features and legal moves are shared through a bounded snapshot cache.
 */
export function evaluate(state: MatchState, perspective: PlayerId): number {
  if (state.phase === 'gameOver') {
    if (state.winner === perspective) return 1_000_000;
    if (state.winner && state.winner !== perspective) return -1_000_000;
    return 0;
  }
  return scoreSnapshot(getEvaluationSnapshot(state), perspective);
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

/**
 * Fast search eval: material/status/tiles + capture-threat hangs (STM-aware).
 * Threat maps cost 2 move-gens; still far cheaper than full snapshot evaluate.
 */
export function evaluateSearch(state: MatchState, perspective: PlayerId): number {
  return evaluateSearchCore(state, perspective, 'full');
}

/**
 * Interior-node eval without capture-threat move-gens (~5–10× faster).
 */
const materialCache = new Map<string, { role: string; base: number; maxHp: number; pawn: boolean; king: boolean }>();

function materialInfo(defId: string) {
  let info = materialCache.get(defId);
  if (info) return info;
  const def = getPieceDefinition(defId);
  info = {
    role: def.baseRole,
    base: def.baseRole === 'king' ? 0 : ROLE_VALUE[def.baseRole] + featureModBonus(def),
    maxHp: def.maxHp,
    pawn: def.baseRole === 'pawn',
    king: def.baseRole === 'king',
  };
  materialCache.set(defId, info);
  return info;
}

export function evaluateSearchFast(state: MatchState, perspective: PlayerId): number {
  // Interior nodes: material + PST only. Tactics from qsearch captures.
  if (state.phase === 'gameOver') {
    if (state.winner === perspective) return 1_000_000;
    if (state.winner && state.winner !== perspective) return -1_000_000;
    return 0;
  }
  let white = 0;
  let black = 0;
  const cx = (state.board.width - 1) * 0.5;
  const cy = (state.board.height - 1) * 0.5;
  const h = Math.max(1, state.board.height - 1);
  const pieces = state.pieces;
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i]!;
    const info = materialInfo(piece.defId);
    let v = 0;
    if (!info.king) {
      const hpFactor = info.maxHp > 0 ? 0.35 + 0.65 * (piece.hp / info.maxHp) : 1;
      v = info.base * hpFactor;
    }
    const distance = Math.abs(piece.pos.x - cx) + Math.abs(piece.pos.y - cy);
    v += Math.max(0, 5 - distance) * (info.pawn ? 2.4 : 2);
    const progress =
      piece.owner === 'white' ? piece.pos.y / h : (state.board.height - 1 - piece.pos.y) / h;
    v += info.pawn ? progress * 18 : progress * 4;
    if (piece.owner === 'white') white += v;
    else black += v;
  }
  return perspective === 'white' ? white - black : black - white;
}

/**
 * Quiescence stand-pat: material + only "our pieces hang to STM" (1 move-gen).
 * Winning captures are discovered by searching them; this stops optimistic
 * stand-pat while our queen is en prise.
 */
export function evaluateSearchQuiet(state: MatchState, perspective: PlayerId): number {
  return evaluateSearchCore(state, perspective, 'quiet');
}

function evaluateSearchCore(
  state: MatchState,
  perspective: PlayerId,
  mode: 'full' | 'fast' | 'quiet',
): number {
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
      abilityValue(piece) * 0.9 +
      pieceSquareValue(state, piece);
    if (buffed.has(piece.id)) v += 40;
    if (piece.owner === 'white') white += v;
    else black += v;
  }

  for (const side of ['white', 'black'] as const) {
    const enemy = opposite(side);
    for (const royal of state.pieces) {
      if (royal.owner !== side || !isRoyalPiece(royal)) continue;
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
      if (side === 'white') white -= pressure;
      else black -= pressure;
    }
  }

  const base = perspective === 'white' ? white - black : black - white;
  if (mode === 'fast') return base;
  if (mode === 'full') return base + threatScoreForPerspective(state, perspective);

  // quiet: one move-gen — opponent takes our hanging pieces.
  return base + stmHangPenalty(state, perspective);
}

/** Penalty when side-to-move's pieces can be taken (1 capture map). */
function stmHangPenalty(state: MatchState, perspective: PlayerId): number {
  const stm = state.activePlayer;
  const enemy = opposite(stm);
  const maps = buildCaptureMaps(state, enemy);
  let loss = 0;
  for (const victim of state.pieces) {
    if (victim.owner !== stm || isRoyalPiece(victim)) continue;
    const key = `${victim.pos.x},${victim.pos.y}`;
    if (!maps.lethalCaptures.has(key) && !maps.captures.has(key)) continue;
    const def = getPieceDefinition(victim.defId);
    const value =
      def.baseRole === 'king' ? 900 : ROLE_VALUE[def.baseRole] + featureModBonus(def);
    const lethal = maps.lethalCaptures.has(key);
    loss += value * (lethal ? 0.95 : 0.45);
  }
  return perspective === stm ? -loss : loss;
}

function squareKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Check detection with a single enemy move-gen (not a full two-sided eval snapshot).
 */
export function isKingEnPriseFast(state: MatchState, side: PlayerId): boolean {
  const enemy = opposite(side);
  const maps = buildCaptureMaps(state, enemy);
  for (let i = 0; i < state.pieces.length; i += 1) {
    const p = state.pieces[i]!;
    if (p.owner !== side || !isRoyalPiece(p)) continue;
    if (maps.lethalCaptures.has(squareKey(p.pos.x, p.pos.y))) return true;
  }
  return false;
}

/** True when any of `side`'s current royal pieces can be lethally captured. */
export function isKingEnPrise(state: MatchState, side: PlayerId): boolean {
  const snapshot = getEvaluationSnapshot(state);
  const enemyLethal = snapshot.moves[opposite(side)].lethalCaptures;
  return snapshot.royalSquares[side].some((square) => enemyLethal.has(square));
}

export function pieceTacticalValue(defId: string): number {
  const def = getPieceDefinition(defId);
  if (def.baseRole === 'king') return 900;
  return ROLE_VALUE[def.baseRole] + featureModBonus(def);
}
