import type { MatchState, PieceInstance } from '@chessforge/engine';

/** Splitmix64-style deterministic u32 from seed. */
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

function key(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h = mix(h ^ (p >>> 0));
  }
  return h;
}

const SIDE_KEY = mix(0x51ceed);
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

/** Board-agnostic square id (supports any width/height). */
function sqKey(x: number, y: number): number {
  return key(0xa11ce01, x | 0, y | 0);
}

function pieceXor(p: PieceInstance): number {
  const sq = sqKey(p.pos.x, p.pos.y);
  const def = hashStr(p.defId);
  const owner = p.owner === 'white' ? 0 : 1;
  let h = key(TAG_PIECE, def, owner, sq);

  const hpBucket = Math.min(7, Math.max(0, p.hp));
  h ^= key(TAG_HP, hpBucket, sq);
  if ((p.frozenTurns ?? 0) > 0) h ^= key(TAG_FROZEN, p.frozenTurns | 0, sq);
  if ((p.shieldTurns ?? 0) > 0) h ^= key(TAG_SHIELD, p.shieldTurns | 0, sq);
  if (p.spikeArmed) h ^= key(TAG_SPIKE, p.spikeTicks | 0, sq);
  if ((p.freezeCooldown ?? 0) > 0) h ^= key(TAG_FREEZE_CD, p.freezeCooldown | 0, sq);
  if (p.windPending) h ^= key(TAG_WIND, 1, sq);
  if (p.hasMoved) h ^= key(TAG_MOVED, 1, sq);

  for (const [abId, used] of Object.entries(p.abilitiesUsed)) {
    if (used) h ^= key(TAG_ABILITY, hashStr(abId), sq);
  }

  return h;
}

/**
 * Zobrist-like 32-bit hash of a match position (enough for TT in-browser).
 * No hardcoded piece/tile id lists — new content hashes by string id.
 */
export function hashPosition(state: MatchState): number {
  let h = 0;
  const { width, height, tiles } = state.board;
  h ^= key(TAG_BOARD, width | 0, height | 0);

  for (let y = 0; y < height; y++) {
    const row = tiles[y];
    if (!row) continue;
    for (let x = 0; x < width; x++) {
      const id = row[x] ?? 'plain';
      if (id === 'plain') continue;
      h ^= key(TAG_TILE, hashStr(id), sqKey(x, y));
    }
  }

  for (const p of state.pieces) {
    h ^= pieceXor(p);
  }

  if (state.activePlayer === 'black') h ^= SIDE_KEY;
  h ^= mix(state.turn | 0);
  h ^= key(TAG_PHASE, hashStr(state.phase), hashStr(state.winner ?? ''));
  return h >>> 0;
}
