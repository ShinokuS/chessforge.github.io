import type { Coord } from './types.js';
import { createRectBoard, withTileOverrides } from './board.js';
import { GENERATABLE_TILE_IDS } from '../defs/tiles/basic.js';
import type { BoardSpec, TileId } from '../match/types.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mirror(pos: Coord, width: number, height: number): Coord {
  return { x: width - 1 - pos.x, y: height - 1 - pos.y };
}

/**
 * Builds an 8×8 board with `count` distinct special tile types on the lower half (y=2..3)
 * and their central-symmetric mirrors on the upper half. Same seed → same board.
 */
export function generateSymmetricBattlefield(seed: number, count = 3): BoardSpec {
  const width = 8;
  const height = 8;
  const rng = mulberry32((seed ^ 0xa5a5a5a5) >>> 0);

  // Shuffle tile pool and take `count` distinct types
  const pool = [...GENERATABLE_TILE_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  const chosenTypes = pool.slice(0, Math.min(count, pool.length));

  const candidates: Coord[] = [];
  for (let y = 2; y <= 3; y++) {
    for (let x = 0; x < width; x++) {
      candidates.push({ x, y });
    }
  }

  // Shuffle candidate positions
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = candidates[i]!;
    candidates[i] = candidates[j]!;
    candidates[j] = tmp;
  }

  const overrides: { pos: Coord; tileId: TileId }[] = [];
  const used = new Set<string>();
  let typeIdx = 0;

  for (const pos of candidates) {
    if (typeIdx >= chosenTypes.length) break;
    const key = `${pos.x},${pos.y}`;
    const m = mirror(pos, width, height);
    const mKey = `${m.x},${m.y}`;
    if (used.has(key) || used.has(mKey)) continue;

    const tileId = chosenTypes[typeIdx++]!;
    overrides.push({ pos, tileId });
    overrides.push({ pos: m, tileId });
    used.add(key);
    used.add(mKey);
  }

  return withTileOverrides(createRectBoard(width, height, 'plain'), overrides);
}
