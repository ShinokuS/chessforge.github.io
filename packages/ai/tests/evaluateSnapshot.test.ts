import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@chessforge/engine', async (importOriginal) => {
  const engine = await importOriginal<typeof import('@chessforge/engine')>();
  return {
    ...engine,
    getLegalMoves: vi.fn(engine.getLegalMoves),
  };
});

import {
  createMatch,
  createPieceInstance,
  createRectBoard,
  getLegalMoves,
} from '@chessforge/engine';
import { evaluate, isKingEnPrise } from '../src/evaluate.js';
import {
  clearEvaluationSnapshotCache,
  getEvaluationSnapshot,
} from '../src/eval/snapshot.js';

function position() {
  return createMatch({
    board: createRectBoard(8, 8, 'plain'),
    pieces: [
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ],
  });
}

describe('evaluation snapshots', () => {
  beforeEach(() => {
    clearEvaluationSnapshotCache();
    vi.mocked(getLegalMoves).mockClear();
  });

  it('generates legal moves once per side and shares the cached snapshot', () => {
    const state = position();

    evaluate(state, 'white');
    evaluate(state, 'black');
    isKingEnPrise(state, 'white');

    expect(getLegalMoves).toHaveBeenCalledTimes(2);
    expect(getEvaluationSnapshot(state)).toBe(getEvaluationSnapshot(state));
  });

  it('invalidates the snapshot when a relevant piece feature changes', () => {
    const state = position();
    const before = getEvaluationSnapshot(state);

    state.pieces.find((piece) => piece.id === 'rw')!.frozenTurns = 1;
    const after = getEvaluationSnapshot(state);

    expect(after).not.toBe(before);
    expect(getLegalMoves).toHaveBeenCalledTimes(4);
  });
});
