import type { TileDefinition, TileId } from '../match/types.js';
import type { Coord } from '../board/types.js';
import { inBounds } from '../board/types.js';
import { getTileDefinition } from '../defs/catalog.js';
import type { BoardSpec } from '../match/types.js';

export function getTileId(board: BoardSpec, pos: Coord): TileId | null {
  if (!inBounds(pos, board.width, board.height)) return null;
  return board.tiles[pos.y]?.[pos.x] ?? null;
}

export function getTileDef(board: BoardSpec, pos: Coord): TileDefinition | null {
  const id = getTileId(board, pos);
  if (!id) return null;
  return getTileDefinition(id);
}

export function isPassable(board: BoardSpec, pos: Coord): boolean {
  const tile = getTileDef(board, pos);
  if (!tile) return false;
  return tile.passable !== false;
}

export function createRectBoard(
  width: number,
  height: number,
  fill: TileId = 'plain',
): BoardSpec {
  const tiles: TileId[][] = [];
  for (let y = 0; y < height; y++) {
    const row: TileId[] = [];
    for (let x = 0; x < width; x++) {
      row.push(fill);
    }
    tiles.push(row);
  }
  return { width, height, tiles };
}

export function withTileOverrides(
  board: BoardSpec,
  overrides: ReadonlyArray<{ pos: Coord; tileId: TileId }>,
): BoardSpec {
  const tiles = board.tiles.map((row) => [...row]);
  for (const { pos, tileId } of overrides) {
    const row = tiles[pos.y];
    if (row && pos.x >= 0 && pos.x < board.width) {
      row[pos.x] = tileId;
    }
  }
  return { ...board, tiles };
}

/** Find the other cave of the same group (first different cell). */
export function findCavePartner(
  board: BoardSpec,
  from: Coord,
): Coord | null {
  const here = getTileDef(board, from);
  if (!here?.caveGroup) return null;
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (x === from.x && y === from.y) continue;
      const t = getTileDef(board, { x, y });
      if (t?.caveGroup === here.caveGroup) {
        return { x, y };
      }
    }
  }
  return null;
}
