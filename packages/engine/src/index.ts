export type { Coord, PlayerId } from './board/types.js';
export { coordKey, coordsEqual, inBounds } from './board/types.js';
export {
  createRectBoard,
  withTileOverrides,
  getTileId,
  getTileDef,
  isPassable,
  findCavePartner,
} from './board/board.js';

export type {
  BoardSpec,
  TileId,
  TileDefinition,
  PieceDefId,
  PieceDefinition,
  PieceRole,
  PieceInstance,
  MovementPattern,
  MatchPhase,
  MatchConfig,
  MatchState,
  MatchStateSnapshot,
  AbilityId,
} from './match/types.js';
export { DECK_COST_CAP } from './match/types.js';

export {
  createMatch,
  createDemoMatch,
  createMatchFromPlacements,
  createPieceInstance,
  createBattlefieldBoard,
  resetPieceIdCounter,
  spawnFromPlacements,
  deckCost,
} from './match/create.js';
export { getLegalMoves, getPieceAt } from './match/queries.js';

export {
  FORMATION_SLOTS,
  classicBasePlacements,
  getFormationSlot,
  slotToCoord,
} from './match/formation.js';
export type { FormationSlot, FormationSlotId, FormationPlacement } from './match/formation.js';

export {
  getPieceDefinition,
  getTileDefinition,
  listPieceDefinitions,
  listPieceDefinitionsByRole,
  listTileDefinitions,
} from './defs/catalog.js';
export { ROLE_LABELS } from './defs/pieces/basic.js';

export { applyCommand } from './commands/apply.js';
export type {
  GameCommand,
  GameEvent,
  ApplyResult,
  ApplySuccess,
  IllegalMoveError,
} from './commands/types.js';

export type { LegalMove } from './pieces/movement.js';
export { getBuffedPieceIds } from './pieces/movement.js';
