import { describe, it, expect } from 'vitest';
import {
  createMatch,
  createPieceInstance,
  createRectBoard,
} from '@chessforge/engine';
import { searchPosition } from '../src/index.js';

/** Denser midgame — closer to what the analysis board actually searches. */
function denseMidgame() {
  return createMatch({
    board: createRectBoard(8, 8, 'plain'),
    activePlayer: 'white',
    pieces: [
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('queen', 'white', { x: 3, y: 0 }, 'qw'),
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw'),
      createPieceInstance('rook', 'white', { x: 7, y: 0 }, 'rw2'),
      createPieceInstance('knight', 'white', { x: 1, y: 0 }, 'nw'),
      createPieceInstance('knight', 'white', { x: 6, y: 0 }, 'nw2'),
      createPieceInstance('bishop', 'white', { x: 2, y: 0 }, 'bw'),
      createPieceInstance('bishop', 'white', { x: 5, y: 0 }, 'bw2'),
      createPieceInstance('pawn', 'white', { x: 0, y: 1 }, 'pw0'),
      createPieceInstance('pawn', 'white', { x: 1, y: 1 }, 'pw1'),
      createPieceInstance('pawn', 'white', { x: 2, y: 1 }, 'pw2'),
      createPieceInstance('pawn', 'white', { x: 3, y: 1 }, 'pw3'),
      createPieceInstance('pawn', 'white', { x: 4, y: 1 }, 'pw4'),
      createPieceInstance('pawn', 'white', { x: 5, y: 1 }, 'pw5'),
      createPieceInstance('pawn', 'white', { x: 6, y: 1 }, 'pw6'),
      createPieceInstance('pawn', 'white', { x: 7, y: 1 }, 'pw7'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      createPieceInstance('queen', 'black', { x: 3, y: 7 }, 'qb'),
      createPieceInstance('rook', 'black', { x: 0, y: 7 }, 'rb'),
      createPieceInstance('rook', 'black', { x: 7, y: 7 }, 'rb2'),
      createPieceInstance('knight', 'black', { x: 1, y: 7 }, 'nb'),
      createPieceInstance('knight', 'black', { x: 6, y: 7 }, 'nb2'),
      createPieceInstance('bishop', 'black', { x: 2, y: 7 }, 'bb'),
      createPieceInstance('bishop', 'black', { x: 5, y: 7 }, 'bb2'),
      createPieceInstance('pawn', 'black', { x: 0, y: 6 }, 'pb0'),
      createPieceInstance('pawn', 'black', { x: 1, y: 6 }, 'pb1'),
      createPieceInstance('pawn', 'black', { x: 2, y: 6 }, 'pb2'),
      createPieceInstance('pawn', 'black', { x: 3, y: 6 }, 'pb3'),
      createPieceInstance('pawn', 'black', { x: 4, y: 6 }, 'pb4'),
      createPieceInstance('pawn', 'black', { x: 5, y: 6 }, 'pb5'),
      createPieceInstance('pawn', 'black', { x: 6, y: 6 }, 'pb6'),
      createPieceInstance('pawn', 'black', { x: 7, y: 6 }, 'pb7'),
    ],
  });
}

describe('full-game / live depth contract', () => {
  it('1.2s slice reaches depth 10+ on dense classic (fast path)', () => {
    const r = searchPosition(denseMidgame(), {
      maxDepth: 14,
      timeMs: 1_200,
      nodeLimit: 200_000_000,
      engine: 'stockfish',
      skill: 10,
      fastAnalysis: true,
    });
    console.log('1.2s slice', { depth: r.depth, nodes: r.nodes, elapsed: r.elapsedMs, nps: r.nps });
    expect(r.depth).toBeGreaterThanOrEqual(10);
  }, 10_000);

  it('∞ time reaches exact maxDepth (full-game / live contract)', () => {
    const target = 10;
    const depths: number[] = [];
    const t0 = Date.now();
    const r = searchPosition(
      denseMidgame(),
      {
        maxDepth: target,
        timeMs: 0,
        nodeLimit: 250_000_000,
        engine: 'stockfish',
        skill: 10,
        fastAnalysis: true,
      },
      (p) => depths.push(p.depth),
    );
    console.log('unlimited', {
      depth: r.depth,
      nodes: r.nodes,
      elapsed: r.elapsedMs,
      nps: r.nps,
      wall: Date.now() - t0,
      depths: [...new Set(depths)],
    });
    expect(r.depth).toBe(target);
    expect(r.stoppedBy).toBe('depth');
    expect(r.elapsedMs).toBeLessThan(1_500);
  }, 10_000);
});
