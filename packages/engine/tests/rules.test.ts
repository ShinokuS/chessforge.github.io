import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createMatch,
  createPieceInstance,
  createRectBoard,
  getLegalMoves,
  resetPieceIdCounter,
  withTileOverrides,
} from '../src/index.js';

function blankMatch(
  pieces: ReturnType<typeof createPieceInstance>[],
  overrides: { pos: { x: number; y: number }; tileId: string }[] = [],
) {
  resetPieceIdCounter(1);
  const board = withTileOverrides(createRectBoard(8, 8, 'plain'), overrides);
  return createMatch({ board, pieces });
}

describe('legal moves', () => {
  it('allows rook slides and blocks on friendly pieces', () => {
    const state = blankMatch([
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'r1'),
      createPieceInstance('pawn', 'white', { x: 0, y: 3 }, 'p1'),
    ]);
    const moves = getLegalMoves(state, { x: 0, y: 0 });
    const targets = moves.map((m) => `${m.to.x},${m.to.y}`);
    expect(targets).toContain('0,1');
    expect(targets).toContain('0,2');
    expect(targets).not.toContain('0,3');
    expect(targets).not.toContain('0,4');
  });

  it('allows knight leaps', () => {
    const state = blankMatch([
      createPieceInstance('knight', 'white', { x: 3, y: 3 }, 'n1'),
    ]);
    const moves = getLegalMoves(state, { x: 3, y: 3 });
    expect(moves.some((m) => m.to.x === 4 && m.to.y === 5)).toBe(true);
    expect(moves.some((m) => m.to.x === 5 && m.to.y === 4)).toBe(true);
  });

  it('pawn moves forward and captures diagonally', () => {
    const state = blankMatch([
      createPieceInstance('pawn', 'white', { x: 4, y: 1 }, 'pw'),
      createPieceInstance('pawn', 'black', { x: 5, y: 2 }, 'pb'),
    ]);
    const moves = getLegalMoves(state, { x: 4, y: 1 });
    expect(moves.some((m) => m.to.x === 4 && m.to.y === 2 && !m.captures)).toBe(true);
    expect(moves.some((m) => m.to.x === 4 && m.to.y === 3 && !m.captures)).toBe(true);
    expect(moves.some((m) => m.to.x === 5 && m.to.y === 2 && m.captures)).toBe(true);
  });
});

describe('tiles', () => {
  it('mud caps movement to 1 except knight', () => {
    const rookState = blankMatch(
      [createPieceInstance('rook', 'white', { x: 3, y: 3 }, 'r1')],
      [{ pos: { x: 3, y: 3 }, tileId: 'mud' }],
    );
    const rookMoves = getLegalMoves(rookState, { x: 3, y: 3 });
    expect(rookMoves.every((m) => Math.max(Math.abs(m.to.x - 3), Math.abs(m.to.y - 3)) <= 1)).toBe(
      true,
    );

    const knightState = blankMatch(
      [createPieceInstance('knight', 'white', { x: 3, y: 3 }, 'n1')],
      [{ pos: { x: 3, y: 3 }, tileId: 'mud' }],
    );
    const knightMoves = getLegalMoves(knightState, { x: 3, y: 3 });
    expect(knightMoves.some((m) => m.to.x === 4 && m.to.y === 5)).toBe(true);
  });

  it('lake is impassable', () => {
    const state = blankMatch(
      [createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'r1')],
      [{ pos: { x: 0, y: 2 }, tileId: 'lake' }],
    );
    const moves = getLegalMoves(state, { x: 0, y: 0 });
    expect(moves.some((m) => m.to.x === 0 && m.to.y === 2)).toBe(false);
    expect(moves.some((m) => m.to.x === 0 && m.to.y === 3)).toBe(false);
  });

  it('cave teleports to partner', () => {
    const state = blankMatch(
      [
        createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'r1'),
        createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      ],
      [
        { pos: { x: 0, y: 2 }, tileId: 'cave' },
        { pos: { x: 7, y: 5 }, tileId: 'cave' },
      ],
    );
    const result = applyCommand(state, {
      type: 'move',
      from: { x: 0, y: 0 },
      to: { x: 0, y: 2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rook = result.state.pieces.find((p) => p.id === 'r1');
    expect(rook?.pos).toEqual({ x: 7, y: 5 });
    expect(result.events.some((e) => e.type === 'Teleported')).toBe(true);
  });

  it('spikes kill after a grace own-turn if piece stays', () => {
    const state = blankMatch(
      [
        createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'r1'),
        createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
        createPieceInstance('pawn', 'black', { x: 1, y: 6 }, 'pb'),
        createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      ],
      [{ pos: { x: 0, y: 1 }, tileId: 'spikes' }],
    );

    // White steps on spikes
    const step1 = applyCommand(state, {
      type: 'move',
      from: { x: 0, y: 0 },
      to: { x: 0, y: 1 },
    });
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    expect(step1.state.pieces.find((p) => p.id === 'r1')?.spikeArmed).toBe(true);
    expect(step1.state.pieces.find((p) => p.id === 'r1')?.spikeTicks).toBe(0);

    // Black moves
    const step2 = applyCommand(step1.state, {
      type: 'move',
      from: { x: 1, y: 6 },
      to: { x: 1, y: 5 },
    });
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    // Start of white turn → grace tick, rook still alive
    const rookAfterGrace = step2.state.pieces.find((p) => p.id === 'r1');
    expect(rookAfterGrace).toBeTruthy();
    expect(rookAfterGrace?.spikeTicks).toBe(1);

    // White passes turn without leaving (move king)
    const step3 = applyCommand(step2.state, {
      type: 'move',
      from: { x: 4, y: 0 },
      to: { x: 4, y: 1 },
    });
    expect(step3.ok).toBe(true);
    if (!step3.ok) return;
    expect(step3.state.pieces.some((p) => p.id === 'r1')).toBe(true);

    // Black moves again
    const step4 = applyCommand(step3.state, {
      type: 'move',
      from: { x: 1, y: 5 },
      to: { x: 1, y: 4 },
    });
    expect(step4.ok).toBe(true);
    if (!step4.ok) return;
    // Second own-turn start on spikes → death
    expect(step4.state.pieces.some((p) => p.id === 'r1')).toBe(false);
    expect(step4.events.some((e) => e.type === 'PieceDestroyed')).toBe(true);
  });

  it('spikes do not kill if piece leaves on grace turn', () => {
    const state = blankMatch(
      [
        createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'r1'),
        createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
        createPieceInstance('pawn', 'black', { x: 1, y: 6 }, 'pb'),
        createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      ],
      [{ pos: { x: 0, y: 1 }, tileId: 'spikes' }],
    );

    const step1 = applyCommand(state, {
      type: 'move',
      from: { x: 0, y: 0 },
      to: { x: 0, y: 1 },
    });
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;

    const step2 = applyCommand(step1.state, {
      type: 'move',
      from: { x: 1, y: 6 },
      to: { x: 1, y: 5 },
    });
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;

    // Leave spikes on grace turn
    const step3 = applyCommand(step2.state, {
      type: 'move',
      from: { x: 0, y: 1 },
      to: { x: 0, y: 3 },
    });
    expect(step3.ok).toBe(true);
    if (!step3.ok) return;
    const rook = step3.state.pieces.find((p) => p.id === 'r1');
    expect(rook?.spikeArmed).toBe(false);
    expect(rook?.pos).toEqual({ x: 0, y: 3 });
  });

  it('mountain gives pawn +1 forward', () => {
    const state = blankMatch(
      [createPieceInstance('pawn', 'white', { x: 4, y: 1 }, 'pw')],
      [{ pos: { x: 4, y: 1 }, tileId: 'mountain' }],
    );
    const moves = getLegalMoves(state, { x: 4, y: 1 });
    // base 1→2 and neverMoved 2→3, plus mountain on the 1-step becomes 2; neverMoved 2 becomes 3
    expect(moves.some((m) => m.to.x === 4 && m.to.y === 2)).toBe(true);
    expect(moves.some((m) => m.to.x === 4 && m.to.y === 3)).toBe(true);
  });
});

describe('combat hp', () => {
  it('ironclad survives one hit', () => {
    const state = blankMatch([
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'r1'),
      createPieceInstance('ironclad', 'black', { x: 0, y: 3 }, 'p1'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const result = applyCommand(state, {
      type: 'move',
      from: { x: 0, y: 0 },
      to: { x: 0, y: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const target = result.state.pieces.find((p) => p.id === 'p1');
    expect(target?.hp).toBe(1);
    expect(result.state.pieces.find((p) => p.id === 'r1')?.pos).toEqual({ x: 0, y: 0 });
    expect(result.events.some((e) => e.type === 'Damaged')).toBe(true);
  });
});

describe('applyCommand basics', () => {
  it('moves a piece and switches turn', () => {
    const state = blankMatch([
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'r1'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const result = applyCommand(state, {
      type: 'move',
      from: { x: 0, y: 0 },
      to: { x: 0, y: 4 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.activePlayer).toBe('black');
  });

  it('rejects illegal moves', () => {
    const state = blankMatch([
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'r1'),
    ]);
    const result = applyCommand(state, {
      type: 'move',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
    });
    expect(result.ok).toBe(false);
  });
});
