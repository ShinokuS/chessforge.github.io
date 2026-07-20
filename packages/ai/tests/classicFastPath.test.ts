import { describe, it, expect } from 'vitest';
import {
  createMatch,
  createPieceInstance,
  createRectBoard,
} from '@chessforge/engine';
import { searchPosition } from '../src/index.js';
import { canUseClassicFastPath } from '../src/classic/detect.js';

function starting() {
  return createMatch({
    board: createRectBoard(8, 8, 'plain'),
    activePlayer: 'white',
    pieces: [
      ...([0, 1, 2, 3, 4, 5, 6, 7] as const).flatMap((x) => [
        createPieceInstance('pawn', 'white', { x, y: 1 }, `pw${x}`),
        createPieceInstance('pawn', 'black', { x, y: 6 }, `pb${x}`),
      ]),
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw0'),
      createPieceInstance('knight', 'white', { x: 1, y: 0 }, 'nw0'),
      createPieceInstance('bishop', 'white', { x: 2, y: 0 }, 'bw0'),
      createPieceInstance('queen', 'white', { x: 3, y: 0 }, 'qw'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('bishop', 'white', { x: 5, y: 0 }, 'bw1'),
      createPieceInstance('knight', 'white', { x: 6, y: 0 }, 'nw1'),
      createPieceInstance('rook', 'white', { x: 7, y: 0 }, 'rw1'),
      createPieceInstance('rook', 'black', { x: 0, y: 7 }, 'rb0'),
      createPieceInstance('knight', 'black', { x: 1, y: 7 }, 'nb0'),
      createPieceInstance('bishop', 'black', { x: 2, y: 7 }, 'bb0'),
      createPieceInstance('queen', 'black', { x: 3, y: 7 }, 'qb'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      createPieceInstance('bishop', 'black', { x: 5, y: 7 }, 'bb1'),
      createPieceInstance('knight', 'black', { x: 6, y: 7 }, 'nb1'),
      createPieceInstance('rook', 'black', { x: 7, y: 7 }, 'rb1'),
    ],
  });
}

describe('classic fast path', () => {
  it('detects starting position', () => {
    expect(canUseClassicFastPath(starting())).toBe(true);
  });

  it('depth 10 on start position in under 2s', () => {
    const t0 = Date.now();
    const r = searchPosition(starting(), {
      maxDepth: 10,
      timeMs: 0,
      nodeLimit: 50_000_000,
      engine: 'stockfish',
      skill: 10,
      fastAnalysis: true,
    });
    const elapsed = Date.now() - t0;
    console.log({
      depth: r.depth,
      elapsed,
      nodes: r.nodes,
      nps: r.nps,
      best: r.best,
    });
    expect(r.depth).toBe(10);
    expect(elapsed).toBeLessThan(2_500);
    expect(r.nps).toBeGreaterThan(50_000);
  }, 15_000);

  it('finds king capture in one move', () => {
    const state = createMatch({
      board: createRectBoard(8, 8, 'plain'),
      activePlayer: 'black',
      pieces: [
        createPieceInstance('king', 'white', { x: 4, y: 4 }, 'kw'),
        createPieceInstance('rook', 'black', { x: 4, y: 7 }, 'rb'),
        createPieceInstance('king', 'black', { x: 0, y: 0 }, 'kb'),
      ],
    });
    expect(canUseClassicFastPath(state)).toBe(true);
    const r = searchPosition(state, {
      maxDepth: 4,
      timeMs: 500,
      engine: 'stockfish',
      skill: 10,
    });
    expect(r.best.type).toBe('move');
    if (r.best.type === 'move') {
      expect(r.best.to).toEqual({ x: 4, y: 4 });
    }
  });
});
