import { describe, it, expect } from 'vitest';
import {
  createMatch,
  createPieceInstance,
  createRectBoard,
} from '@chessforge/engine';
import { searchPosition } from '../src/index.js';

function midgame() {
  return createMatch({
    board: createRectBoard(8, 8, 'plain'),
    activePlayer: 'white',
    pieces: [
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('queen', 'white', { x: 3, y: 0 }, 'qw'),
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw'),
      createPieceInstance('knight', 'white', { x: 1, y: 0 }, 'nw'),
      createPieceInstance('bishop', 'white', { x: 2, y: 0 }, 'bw'),
      createPieceInstance('pawn', 'white', { x: 4, y: 1 }, 'pw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      createPieceInstance('queen', 'black', { x: 3, y: 7 }, 'qb'),
      createPieceInstance('rook', 'black', { x: 0, y: 7 }, 'rb'),
      createPieceInstance('knight', 'black', { x: 1, y: 7 }, 'nb'),
      createPieceInstance('bishop', 'black', { x: 2, y: 7 }, 'bb'),
      createPieceInstance('pawn', 'black', { x: 4, y: 6 }, 'pb'),
    ],
  });
}

describe('analysis speed contract', () => {
  it('∞ live climbs completed depths without hanging on depth 5', () => {
    const depths: number[] = [];
    const t0 = Date.now();
    // Cap wall time via nodeLimit so ∞ test finishes; ID still completes iters.
    const r = searchPosition(
      midgame(),
      {
        maxDepth: 10,
        timeMs: 0,
        nodeLimit: 80_000,
        engine: 'stockfish',
        skill: 10,
        fastAnalysis: true,
      },
      (p) => depths.push(p.depth),
    );
    const elapsed = Date.now() - t0;
    console.log({
      depth: r.depth,
      elapsed,
      depths: [...new Set(depths)],
      stoppedBy: r.stoppedBy,
      nps: r.nps,
    });
    expect(r.depth).toBeGreaterThanOrEqual(6);
    expect(elapsed).toBeLessThan(20_000);
    // Must have published intermediate depths (not stuck silent until the end).
    expect(new Set(depths).size).toBeGreaterThanOrEqual(4);
  }, 30_000);

  it('timed 5s reaches depth 8+ (completed iters only)', () => {
    const t0 = Date.now();
    const r = searchPosition(midgame(), {
      maxDepth: 14,
      timeMs: 5_000,
      nodeLimit: 200_000_000,
      engine: 'stockfish',
      skill: 10,
      fastAnalysis: true,
    });
    console.log({
      depth: r.depth,
      elapsed: Date.now() - t0,
      stoppedBy: r.stoppedBy,
      nps: r.nps,
      nodes: r.nodes,
    });
    expect(r.depth).toBeGreaterThanOrEqual(10);
    expect(Date.now() - t0).toBeLessThan(7_000);
  }, 15_000);

  it('full-game 5s slice matches live timed quality (depth 10+)', () => {
    const r = searchPosition(midgame(), {
      maxDepth: 14,
      timeMs: 5_000,
      nodeLimit: 200_000_000,
      engine: 'stockfish',
      skill: 10,
      fastAnalysis: true,
      ttBits: 17,
    });
    console.log({
      depth: r.depth,
      elapsed: r.elapsedMs,
      stoppedBy: r.stoppedBy,
      nps: r.nps,
    });
    expect(r.depth).toBeGreaterThanOrEqual(10);
  }, 12_000);
});
