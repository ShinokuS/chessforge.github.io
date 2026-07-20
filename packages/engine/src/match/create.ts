import { createRectBoard, withTileOverrides } from '../board/board.js';
import { generateSymmetricBattlefield } from '../board/generate.js';
import { getPieceDefinition } from '../defs/catalog.js';
import type { Coord, PlayerId } from '../board/types.js';
import type { MatchConfig, MatchState, PieceInstance } from './types.js';
import { applyCommand } from '../commands/apply.js';
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
    abilityCooldowns: {},
    spikeArmed: false,
    spikeTicks: 0,
    frozenTurns: 0,
    freezeCooldown: 0,
    windPending: false,
    shieldTurns: 0,
    isRoyal: def.baseRole === 'king',
    reflectAvailable: Boolean(def.reflectDamageOnce),
    promotesToBaseQueen: false,
    invisibleTurns: 0,
    doubleMoveArmed: false,
  };
}

export function createMatch(config: MatchConfig): MatchState {
  return {
    board: config.board,
    pieces: config.pieces.map((p) => ({
      ...p,
      pos: { ...p.pos },
      abilitiesUsed: { ...p.abilitiesUsed },
      abilityCooldowns: { ...(p.abilityCooldowns ?? {}) },
      frozenTurns: p.frozenTurns ?? 0,
      freezeCooldown: p.freezeCooldown ?? 0,
      spikeArmed: p.spikeArmed ?? false,
      spikeTicks: p.spikeTicks ?? 0,
      windPending: p.windPending ?? false,
      shieldTurns: p.shieldTurns ?? 0,
      isRoyal: p.isRoyal ?? getPieceDefinition(p.defId).baseRole === 'king',
      reflectAvailable:
        p.reflectAvailable ?? Boolean(getPieceDefinition(p.defId).reflectDamageOnce),
      promotesToBaseQueen: p.promotesToBaseQueen ?? false,
      ...(p.cursedCannotHarmId !== undefined
        ? { cursedCannotHarmId: p.cursedCannotHarmId }
        : {}),
      invisibleTurns: p.invisibleTurns ?? 0,
      doubleMoveArmed: p.doubleMoveArmed ?? false,
    })),
    activePlayer: config.activePlayer ?? 'white',
    turn: 1,
    phase: 'play',
    winner: null,
    seed: config.seed ?? 1,
    rngStep: 0,
    extraMovePieceId: null,
    skipFirstTurnUsed: { white: false, black: false },
  };
}

function sideSkipsFirstTurn(state: MatchState, owner: PlayerId): boolean {
  return state.pieces.some(
    (p) => p.owner === owner && getPieceDefinition(p.defId).skipFirstTurn,
  );
}

function applyOpeningPass(state: MatchState): MatchState {
  let current = state;
  if (current.turn === 1 && sideSkipsFirstTurn(current, current.activePlayer)) {
    const pass = applyCommand(current, { type: 'endTurn' });
    if (pass.ok) {
      current = pass.state;
      const skipped = pass.events
        .filter(
          (e): e is { type: 'TurnSkipped'; player: PlayerId; reason: 'skipFirstTurn' } =>
            e.type === 'TurnSkipped' && e.reason === 'skipFirstTurn',
        )
        .map((e) => e.player);
      if (skipped.length > 0) {
        current.openingSkipSequence = skipped;
      }
    }
  }
  return current;
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
  return applyOpeningPass(
    createMatch({
      board: createBattlefieldBoard(),
      pieces: [
        ...spawnFromPlacements(placements, 'white'),
        ...spawnFromPlacements(placements, 'black'),
      ],
      seed: 42,
    }),
  );
}

export function createMatchFromPlacements(
  white: ReadonlyArray<FormationPlacement>,
  black: ReadonlyArray<FormationPlacement> = classicBasePlacements(),
  seed = 7,
): MatchState {
  resetPieceIdCounter(1);
  return applyOpeningPass(
    createMatch({
      board: generateSymmetricBattlefield(seed),
      pieces: [
        ...spawnFromPlacements(white, 'white'),
        ...spawnFromPlacements(black, 'black'),
      ],
      seed,
    }),
  );
}

export function deckCost(placements: ReadonlyArray<FormationPlacement>): number {
  return placements.reduce((sum, p) => sum + getPieceDefinition(p.defId).cost, 0);
}
