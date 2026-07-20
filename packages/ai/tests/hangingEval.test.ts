import { describe, expect, it } from 'vitest';
import {
  createMatch,
  createPieceInstance,
  createRectBoard,
  type MatchState,
  type PieceInstance,
} from '@chessforge/engine';
import { evaluate, evaluateSearch, searchPosition } from '../src/index.js';

function blank(pieces: PieceInstance[], active: 'white' | 'black' = 'black'): MatchState {
  return createMatch({
    board: createRectBoard(8, 8, 'plain'),
    activePlayer: active,
    pieces,
  });
}

describe('hanging eval visibility', () => {
  it('sees one-way hanging knight before it is captured', () => {
    const before = blank(
      [
        createPieceInstance('knight', 'white', { x: 4, y: 3 }, 'nw'),
        createPieceInstance('rook', 'black', { x: 4, y: 7 }, 'rb'),
        createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 7, y: 7 }, 'kb'),
      ],
      'black',
    );
    const after = blank(
      [
        createPieceInstance('rook', 'black', { x: 4, y: 3 }, 'rb'),
        createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 7, y: 7 }, 'kb'),
      ],
      'white',
    );

    const staticBefore = evaluate(before, 'white');
    const searchBefore = evaluateSearch(before, 'white');
    const staticAfter = evaluate(after, 'white');
    const engine = searchPosition(before, {
      maxDepth: 4,
      timeMs: 800,
      nodeLimit: 120_000,
      engine: 'stockfish',
    });

    expect(staticAfter).toBeLessThan(-200);
    expect(engine.scoreWhite).toBeLessThan(-200);
    // Before the capture, hanging must already look like a big white deficit.
    expect(searchBefore).toBeLessThan(-250);
    expect(staticBefore).toBeLessThan(-250);
    // And close to the post-capture static (not only after material leaves the board).
    expect(Math.abs(searchBefore - staticAfter)).toBeLessThan(280);
  });

  it('sees mutual queen hang when side to move can take first', () => {
    // Kings placed so neither queen checks a king (avoids royal-safety mate spike).
    const before = blank(
      [
        createPieceInstance('queen', 'white', { x: 3, y: 3 }, 'qw'),
        createPieceInstance('queen', 'black', { x: 3, y: 6 }, 'qb'),
        createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 6, y: 7 }, 'kb'),
      ],
      'black',
    );
    const staticBefore = evaluate(before, 'white');
    const searchBefore = evaluateSearch(before, 'white');
    const engine = searchPosition(before, {
      maxDepth: 4,
      timeMs: 800,
      nodeLimit: 120_000,
      engine: 'stockfish',
    });

    // Static net is muted (both queens hang); search must still prefer taking first.
    expect(engine.scoreWhite).toBeLessThan(-300);
    expect(searchBefore).toBeLessThan(-100);
    expect(staticBefore).toBeLessThan(-100);
  });

  it('swings on the blunder ply, not only after the opponent captures', () => {
    // One-way hang: black rook can take white knight; knight does not attack the rook.
    const quiet = blank(
      [
        createPieceInstance('knight', 'white', { x: 0, y: 0 }, 'nw'),
        createPieceInstance('rook', 'black', { x: 7, y: 7 }, 'rb'),
        createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      ],
      'black',
    );
    const hung = blank(
      [
        createPieceInstance('knight', 'white', { x: 4, y: 3 }, 'nw'),
        createPieceInstance('rook', 'black', { x: 4, y: 7 }, 'rb'),
        createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 7, y: 0 }, 'kb'),
      ],
      'black',
    );
    const captured = blank(
      [
        createPieceInstance('rook', 'black', { x: 4, y: 3 }, 'rb'),
        createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 7, y: 0 }, 'kb'),
      ],
      'white',
    );

    const quietScore = evaluateSearch(quiet, 'white');
    const hungScore = evaluateSearch(hung, 'white');
    const capturedScore = evaluateSearch(captured, 'white');
    const hungEngine = searchPosition(hung, {
      maxDepth: 3,
      timeMs: 400,
      nodeLimit: 80_000,
      engine: 'stockfish',
    });

    // Blunder ply must already collapse vs the quiet baseline.
    expect(quietScore - hungScore).toBeGreaterThan(250);
    expect(hungScore).toBeLessThan(-200);
    expect(hungEngine.scoreWhite).toBeLessThan(-200);
    // Capture ply should not be the *first* place the swing appears.
    expect(Math.abs(hungScore - capturedScore)).toBeLessThan(280);
  });

  it('credits multi-HP non-lethal hangs before the chip is applied', () => {
    // Bishop maxHp=2, attack=1 → first capture is non-lethal.
    const hung = blank(
      [
        createPieceInstance('bishop', 'white', { x: 4, y: 4 }, 'bw'),
        createPieceInstance('rook', 'black', { x: 4, y: 7 }, 'rb'),
        createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 7, y: 0 }, 'kb'),
      ],
      'black',
    );
    const safe = blank(
      [
        createPieceInstance('bishop', 'white', { x: 0, y: 2 }, 'bw'),
        createPieceInstance('rook', 'black', { x: 7, y: 7 }, 'rb'),
        createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      ],
      'black',
    );

    const hungScore = evaluateSearch(hung, 'white');
    const safeScore = evaluateSearch(safe, 'white');
    expect(safeScore - hungScore).toBeGreaterThan(120);
    expect(hungScore).toBeLessThan(safeScore - 100);
  });
});
