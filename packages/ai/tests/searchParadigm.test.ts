import { describe, expect, it } from 'vitest';
import {
  createMatch,
  createPieceInstance,
  createRectBoard,
  type MatchState,
  type PieceInstance,
} from '@chessforge/engine';
import { searchPosition } from '../src/index.js';

function blank(pieces: PieceInstance[], active: 'white' | 'black' = 'white'): MatchState {
  return createMatch({
    board: createRectBoard(8, 8, 'plain'),
    activePlayer: active,
    pieces,
  });
}

describe('stockfish search paradigm', () => {
  it('reaches meaningful depth under a normal time budget', () => {
    const state = blank([
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('queen', 'white', { x: 3, y: 0 }, 'qw'),
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      createPieceInstance('queen', 'black', { x: 3, y: 7 }, 'qb'),
      createPieceInstance('rook', 'black', { x: 0, y: 7 }, 'rb'),
    ]);

    const result = searchPosition(state, {
      maxDepth: 14,
      timeMs: 1_200,
      nodeLimit: 50_000_000,
      engine: 'stockfish',
      skill: 10,
    });

    expect(result.depth).toBeGreaterThanOrEqual(6);
    expect(result.nodes).toBeGreaterThan(1_000);
  });

  it('finds a one-move king kill (hanging king)', () => {
    // Black to move: rook takes white king on the open file.
    const state = blank(
      [
        createPieceInstance('king', 'white', { x: 4, y: 4 }, 'kw'),
        createPieceInstance('rook', 'black', { x: 4, y: 7 }, 'rb'),
        createPieceInstance('king', 'black', { x: 0, y: 0 }, 'kb'),
      ],
      'black',
    );

    const result = searchPosition(state, {
      maxDepth: 8,
      timeMs: 800,
      nodeLimit: 20_000_000,
      engine: 'stockfish',
      skill: 10,
    });

    expect(result.best.type).toBe('move');
    if (result.best.type === 'move') {
      expect(result.best.to).toEqual({ x: 4, y: 4 });
    }
    expect(result.scoreWhite).toBeLessThan(-10_000);
  });

  it('full-window search matches deeper tactical hang than shallow static', () => {
    const hung = blank(
      [
        createPieceInstance('queen', 'white', { x: 4, y: 3 }, 'qw'),
        createPieceInstance('rook', 'black', { x: 4, y: 7 }, 'rb'),
        createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 7, y: 0 }, 'kb'),
      ],
      'black',
    );

    const shallow = searchPosition(hung, {
      maxDepth: 2,
      timeMs: 50,
      nodeLimit: 50_000,
      engine: 'stockfish',
    });
    const deep = searchPosition(hung, {
      maxDepth: 8,
      timeMs: 600,
      nodeLimit: 20_000_000,
      engine: 'stockfish',
    });

    expect(deep.depth).toBeGreaterThanOrEqual(4);
    expect(deep.scoreWhite).toBeLessThan(-200);
    // Deeper search must not invent a quiet eval while a queen hangs.
    expect(deep.scoreWhite).toBeLessThanOrEqual(shallow.scoreWhite + 50);
  });
});
