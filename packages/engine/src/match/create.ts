import { createRectBoard, withTileOverrides } from '../board/board.js';
import { generateSymmetricBattlefield } from '../board/generate.js';
import { getPieceDefinition } from '../defs/catalog.js';
import type { Coord, PlayerId } from '../board/types.js';
import type { MatchConfig, MatchState, PieceInstance } from './types.js';
import {
  classicBasePlacements,
  getFormationSlot,
  slotToCoord,
  type FormationPlacement,
} from './formation.js';

let nextId = 1;

export function resetPieceIdCounter(value = 1): void {
  nextId = value;
}

export function createPieceInstance(
  defId: string,
  owner: PlayerId,
  pos: Coord,
  id?: string,
): PieceInstance {
  const def = getPieceDefinition(defId);
  return {
    id: id ?? `piece-${nextId++}`,
    defId,
    owner,
    pos: { ...pos },
    hp: def.maxHp,
    hasMoved: false,
    abilitiesUsed: {},
    spikeArmed: false,
    spikeTicks: 0,
    frozenTurns: 0,
    freezeCooldown: 0,
    windPending: false,
    shieldTurns: 0,
  };
}

export function createMatch(config: MatchConfig): MatchState {
  return {
    board: config.board,
    pieces: config.pieces.map((p) => ({
      ...p,
      pos: { ...p.pos },
      abilitiesUsed: { ...p.abilitiesUsed },
      frozenTurns: p.frozenTurns ?? 0,
      freezeCooldown: p.freezeCooldown ?? 0,
      spikeArmed: p.spikeArmed ?? false,
      spikeTicks: p.spikeTicks ?? 0,
      windPending: p.windPending ?? false,
      shieldTurns: p.shieldTurns ?? 0,
    })),
    activePlayer: config.activePlayer ?? 'white',
    turn: 1,
    phase: 'play',
    winner: null,
    seed: config.seed ?? 1,
    rngStep: 0,
  };
}

export function spawnFromPlacements(
  placements: ReadonlyArray<FormationPlacement>,
  owner: PlayerId,
): PieceInstance[] {
  const pieces: PieceInstance[] = [];
  for (const { slotId, defId } of placements) {
    const slot = getFormationSlot(slotId);
    const def = getPieceDefinition(defId);
    if (def.baseRole !== slot.role) {
      throw new Error(
        `Piece ${defId} (role ${def.baseRole}) cannot fill slot ${slotId} (${slot.role})`,
      );
    }
    pieces.push(createPieceInstance(defId, owner, slotToCoord(slot, owner)));
  }
  return pieces;
}

/** Fixed demo layout (tests / preview). Prefer generateSymmetricBattlefield for matches. */
export function createBattlefieldBoard() {
  return withTileOverrides(createRectBoard(8, 8, 'plain'), [
    { pos: { x: 2, y: 3 }, tileId: 'mud' },
    { pos: { x: 5, y: 4 }, tileId: 'mud' },
    { pos: { x: 3, y: 5 }, tileId: 'spikes' },
    { pos: { x: 4, y: 2 }, tileId: 'spikes' },
    { pos: { x: 1, y: 4 }, tileId: 'mountain' },
    { pos: { x: 6, y: 3 }, tileId: 'mountain' },
    { pos: { x: 0, y: 3 }, tileId: 'cave' },
    { pos: { x: 7, y: 4 }, tileId: 'cave' },
    { pos: { x: 3, y: 3 }, tileId: 'lake' },
    { pos: { x: 4, y: 4 }, tileId: 'lake' },
  ]);
}

export function createDemoMatch(): MatchState {
  resetPieceIdCounter(1);
  const placements = classicBasePlacements();
  return createMatch({
    board: createBattlefieldBoard(),
    pieces: [
      ...spawnFromPlacements(placements, 'white'),
      ...spawnFromPlacements(placements, 'black'),
    ],
    seed: 42,
  });
}

export function createMatchFromPlacements(
  white: ReadonlyArray<FormationPlacement>,
  black: ReadonlyArray<FormationPlacement> = classicBasePlacements(),
  seed = 7,
): MatchState {
  resetPieceIdCounter(1);
  return createMatch({
    board: generateSymmetricBattlefield(seed),
    pieces: [
      ...spawnFromPlacements(white, 'white'),
      ...spawnFromPlacements(black, 'black'),
    ],
    seed,
  });
}

export function deckCost(placements: ReadonlyArray<FormationPlacement>): number {
  return placements.reduce((sum, p) => sum + getPieceDefinition(p.defId).cost, 0);
}
