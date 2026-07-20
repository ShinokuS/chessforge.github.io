import type { MatchState, PieceInstance } from '@chessforge/engine';

export type PositionHashPair = {
  low: number;
  high: number;
};

const LOW_SEED = 0x243f6a88;
const HIGH_SEED = 0x9e3779b9;

/** Deterministic avalanche from a u32 seed. */
function mix(seed: number): number {
  let z = (seed + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/** FNV-1a style string → u32 (any future defId / tileId). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function key(seed: number, ...parts: number[]): number {
  let h = seed;
  for (const p of parts) {
    h = mix(h ^ (p >>> 0));
  }
  return h >>> 0;
}

const TAG_BOARD = 0xb0a2d01;
const TAG_TILE = 0x71e1001;
const TAG_PIECE = 0x71ece01;
const TAG_HP = 0x1100001;
const TAG_FROZEN = 0x2200001;
const TAG_SHIELD = 0x3300001;
const TAG_SPIKE = 0x4400001;
const TAG_FREEZE_CD = 0x5500001;
const TAG_WIND = 0x6600001;
const TAG_MOVED = 0x7700001;
const TAG_ABILITY = 0x8800001;
const TAG_PHASE = 0x9100001;
const TAG_ABILITY_COOLDOWN = 0x9200001;
const TAG_ROYAL = 0x9300001;
const TAG_REFLECT = 0x9400001;
const TAG_PROMOTES = 0x9500001;
const TAG_CURSE = 0x9600001;
const TAG_INVISIBLE = 0x9700001;
const TAG_DOUBLE_MOVE = 0x9800001;
const TAG_ACTIVE_PLAYER = 0x9900001;
const TAG_TURN = 0x9a00001;
const TAG_SEED = 0x9b00001;
const TAG_RNG_STEP = 0x9c00001;
const TAG_EXTRA_MOVE = 0x9d00001;
const TAG_SKIP_USED = 0x9e00001;
const TAG_OPENING_SKIP = 0x9f00001;

/** Board-agnostic square id (supports any width/height). */
function sqKey(seed: number, x: number, y: number): number {
  return key(seed, 0xa11ce01, x | 0, y | 0);
}

function pieceXor(seed: number, p: PieceInstance): number {
  const sq = sqKey(seed, p.pos.x, p.pos.y);
  const owner = p.owner === 'white' ? 0 : 1;
  const identity = hashStr(p.id);
  let h = key(seed, TAG_PIECE, identity, hashStr(p.defId), owner, sq);

  h ^= key(seed, TAG_HP, identity, p.hp | 0);
  h ^= key(seed, TAG_FROZEN, identity, p.frozenTurns ?? 0);
  h ^= key(seed, TAG_SHIELD, identity, p.shieldTurns ?? 0);
  h ^= key(seed, TAG_SPIKE, identity, p.spikeArmed ? 1 : 0, p.spikeTicks ?? 0);
  h ^= key(seed, TAG_FREEZE_CD, identity, p.freezeCooldown ?? 0);
  h ^= key(seed, TAG_WIND, identity, p.windPending ? 1 : 0);
  h ^= key(seed, TAG_MOVED, identity, p.hasMoved ? 1 : 0);
  h ^= key(seed, TAG_ROYAL, identity, p.isRoyal ? 1 : 0);
  h ^= key(seed, TAG_REFLECT, identity, p.reflectAvailable ? 1 : 0);
  h ^= key(seed, TAG_PROMOTES, identity, p.promotesToBaseQueen ? 1 : 0);
  h ^= key(seed, TAG_CURSE, identity, hashStr(p.cursedCannotHarmId ?? ''));
  h ^= key(seed, TAG_INVISIBLE, identity, p.invisibleTurns ?? 0);
  h ^= key(seed, TAG_DOUBLE_MOVE, identity, p.doubleMoveArmed ? 1 : 0);

  for (const [abId, used] of Object.entries(p.abilitiesUsed)) {
    if (used) h ^= key(seed, TAG_ABILITY, identity, hashStr(abId));
  }
  for (const [abId, cooldown] of Object.entries(p.abilityCooldowns)) {
    if ((cooldown ?? 0) > 0) {
      h ^= key(seed, TAG_ABILITY_COOLDOWN, identity, hashStr(abId), cooldown);
    }
  }

  return h >>> 0;
}

function hashWithSeed(state: MatchState, seed: number): number {
  let h = key(seed, TAG_BOARD);
  const { width, height, tiles } = state.board;
  h ^= key(seed, TAG_BOARD, width | 0, height | 0);

  for (let y = 0; y < height; y++) {
    const row = tiles[y];
    for (let x = 0; x < width; x++) {
      const id = row?.[x] ?? 'plain';
      h ^= key(seed, TAG_TILE, hashStr(id), sqKey(seed, x, y));
    }
  }

  for (const p of state.pieces) {
    h ^= pieceXor(seed, p);
  }

  h ^= key(seed, TAG_ACTIVE_PLAYER, state.activePlayer === 'white' ? 0 : 1);
  h ^= key(seed, TAG_TURN, state.turn | 0);
  h ^= key(seed, TAG_PHASE, hashStr(state.phase), hashStr(state.winner ?? ''));
  h ^= key(seed, TAG_SEED, state.seed | 0);
  h ^= key(seed, TAG_RNG_STEP, state.rngStep | 0);
  h ^= key(seed, TAG_EXTRA_MOVE, hashStr(state.extraMovePieceId ?? ''));
  h ^= key(seed, TAG_SKIP_USED, 0, state.skipFirstTurnUsed?.white ? 1 : 0);
  h ^= key(seed, TAG_SKIP_USED, 1, state.skipFirstTurnUsed?.black ? 1 : 0);
  for (const [index, player] of (state.openingSkipSequence ?? []).entries()) {
    h ^= key(seed, TAG_OPENING_SKIP, index, player === 'white' ? 0 : 1);
  }
  return h >>> 0;
}

/**
 * Two independently seeded 32-bit hashes of all state that can affect play.
 * New piece, ability, and tile ids are supported without hardcoded id lists.
 */
export function hashPositionPair(state: MatchState): PositionHashPair {
  return {
    low: hashWithSeed(state, LOW_SEED),
    high: hashWithSeed(state, HIGH_SEED),
  };
}

/** Backwards-compatible low 32-bit position hash used by the current TT. */
export function hashPosition(state: MatchState): number {
  return hashPositionPair(state).low;
}
