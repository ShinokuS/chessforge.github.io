import type {
  PieceDefId,
  PieceDefinition,
  PieceRole,
  TileDefinition,
  TileId,
} from '../match/types.js';
import { PIECE_DEFS } from './pieces/basic.js';
import { TILE_DEFS } from './tiles/basic.js';

const pieceById = new Map<PieceDefId, PieceDefinition>(
  PIECE_DEFS.map((d) => [d.id, d]),
);

const tileById = new Map<TileId, TileDefinition>(TILE_DEFS.map((d) => [d.id, d]));

export function getPieceDefinition(id: PieceDefId): PieceDefinition {
  const def = pieceById.get(id);
  if (!def) {
    throw new Error(`Unknown piece definition: ${id}`);
  }
  return def;
}

export function getTileDefinition(id: TileId): TileDefinition {
  const def = tileById.get(id);
  if (!def) {
    throw new Error(`Unknown tile definition: ${id}`);
  }
  return def;
}

export function listPieceDefinitions(): PieceDefinition[] {
  return [...PIECE_DEFS];
}

export function listTileDefinitions(): TileDefinition[] {
  return [...TILE_DEFS];
}

export function listPieceDefinitionsByRole(role: PieceRole): PieceDefinition[] {
  return PIECE_DEFS.filter((d) => d.baseRole === role);
}
