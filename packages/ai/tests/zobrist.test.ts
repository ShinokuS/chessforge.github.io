import { describe, expect, it } from 'vitest';
import {
  createMatch,
  createPieceInstance,
  createRectBoard,
  withTileOverrides,
  type MatchState,
} from '@chessforge/engine';
import { hashPosition, hashPositionPair } from '../src/zobrist.js';

function position(): MatchState {
  return createMatch({
    board: createRectBoard(4, 4, 'plain'),
    pieces: [
      createPieceInstance('king', 'white', { x: 0, y: 0 }, 'white-king'),
      createPieceInstance('rook', 'white', { x: 1, y: 0 }, 'white-rook'),
      createPieceInstance('king', 'black', { x: 3, y: 3 }, 'black-king'),
    ],
    activePlayer: 'white',
    seed: 12345,
  });
}

function expectDifferent(a: MatchState, b: MatchState): void {
  expect(hashPositionPair(a)).not.toEqual(hashPositionPair(b));
}

describe('hashPositionPair', () => {
  it('is deterministic for a structural clone and preserves the number API', () => {
    const state = position();
    const clone = structuredClone(state);

    expect(hashPositionPair(clone)).toEqual(hashPositionPair(state));
    expect(hashPosition(state)).toBe(hashPositionPair(state).low);
  });

  it('distinguishes an extra-move continuation', () => {
    const base = position();
    const extraMove = structuredClone(base);
    extraMove.extraMovePieceId = 'white-rook';
    extraMove.pieces[1]!.doubleMoveArmed = true;

    expectDifferent(base, extraMove);
  });

  it('distinguishes piece statuses', () => {
    const base = position();
    const invisible = structuredClone(base);
    invisible.pieces[1]!.invisibleTurns = 2;
    const abilityUsed = structuredClone(base);
    abilityUsed.pieces[1]!.abilitiesUsed.retreat = true;

    expectDifferent(base, invisible);
    expectDifferent(base, abilityUsed);
  });

  it('distinguishes board tiles', () => {
    const base = position();
    const tiled = structuredClone(base);
    tiled.board = withTileOverrides(tiled.board, [
      { pos: { x: 2, y: 2 }, tileId: 'spikes' },
    ]);

    expectDifferent(base, tiled);
  });

  it('distinguishes RNG progress', () => {
    const base = position();
    const advanced = structuredClone(base);
    advanced.rngStep += 1;

    expectDifferent(base, advanced);
  });
});
