import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createMatch,
  createPieceInstance,
  createRectBoard,
  getBuffedPieceIds,
  getLegalMoves,
  getPieceDefinition,
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

describe('chaplain line buff', () => {
  it('buffs allies on diagonal but not enemies', () => {
    const state = blankMatch([
      createPieceInstance('chaplain', 'white', { x: 2, y: 2 }, 'ch'),
      createPieceInstance('pawn', 'white', { x: 4, y: 4 }, 'pw'),
      createPieceInstance('pawn', 'black', { x: 0, y: 4 }, 'pb'),
      createPieceInstance('king', 'white', { x: 7, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 7, y: 7 }, 'kb'),
    ]);
    const buffed = getBuffedPieceIds(state);
    expect(buffed.has('pw')).toBe(true);
    expect(buffed.has('pb')).toBe(false);
    expect(buffed.has('ch')).toBe(false);

    // Ally pawn gains king-aura (e.g. sideways)
    const allyMoves = getLegalMoves(state, { x: 4, y: 4 });
    expect(allyMoves.some((m) => m.to.x === 5 && m.to.y === 4)).toBe(true);

    // Enemy on other diagonal does not gain aura
    const enemyState = {
      ...state,
      activePlayer: 'black' as const,
    };
    const enemyMoves = getLegalMoves(enemyState, { x: 0, y: 4 });
    expect(enemyMoves.some((m) => m.to.x === 1 && m.to.y === 4)).toBe(false);
  });
});

describe('castling', () => {
  it('allows kingside and queenside when path clear', () => {
    const state = blankMatch([
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('rook', 'white', { x: 7, y: 0 }, 'rh'),
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'ra'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const moves = getLegalMoves(state, { x: 4, y: 0 });
    expect(moves.some((m) => m.castle === 'kingside' && m.to.x === 6)).toBe(true);
    expect(moves.some((m) => m.castle === 'queenside' && m.to.x === 2)).toBe(true);

    const result = applyCommand(state, {
      type: 'move',
      from: { x: 4, y: 0 },
      to: { x: 6, y: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pieces.find((p) => p.id === 'kw')?.pos).toEqual({ x: 6, y: 0 });
    expect(result.state.pieces.find((p) => p.id === 'rh')?.pos).toEqual({ x: 5, y: 0 });
    expect(result.events.some((e) => e.type === 'Castled' && e.side === 'kingside')).toBe(true);
  });

  it('blocks castling when path occupied', () => {
    const state = blankMatch([
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('rook', 'white', { x: 7, y: 0 }, 'rh'),
      createPieceInstance('knight', 'white', { x: 5, y: 0 }, 'n'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const moves = getLegalMoves(state, { x: 4, y: 0 });
    expect(moves.some((m) => m.castle === 'kingside')).toBe(false);
  });
});

describe('sprinter allyLeap', () => {
  it('can leap over an adjacent ally once', () => {
    const state = blankMatch([
      createPieceInstance('sprinter', 'white', { x: 0, y: 0 }, 'sp'),
      createPieceInstance('pawn', 'white', { x: 0, y: 1 }, 'pw'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const moves = getLegalMoves(state, { x: 0, y: 0 });
    expect(moves.some((m) => m.abilityId === 'allyLeap' && m.to.x === 0 && m.to.y === 2)).toBe(
      true,
    );
    const result = applyCommand(state, {
      type: 'move',
      from: { x: 0, y: 0 },
      to: { x: 0, y: 2 },
      abilityId: 'allyLeap',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pieces.find((p) => p.id === 'sp')?.pos).toEqual({ x: 0, y: 2 });
    expect(result.state.pieces.find((p) => p.id === 'sp')?.abilitiesUsed.allyLeap).toBe(true);
  });
});

describe('anchor king', () => {
  it('has no legal moves and negative cost', () => {
    expect(getPieceDefinition('anchor').cost).toBe(-3);
    const state = blankMatch([
      createPieceInstance('anchor', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('rook', 'white', { x: 7, y: 0 }, 'rh'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    expect(getLegalMoves(state, { x: 4, y: 0 })).toHaveLength(0);
  });
});

describe('cryomancer freeze', () => {
  it('freezes instead of capturing and blocks target for a turn', () => {
    const state = blankMatch([
      createPieceInstance('cryomancer', 'white', { x: 0, y: 0 }, 'cq'),
      createPieceInstance('pawn', 'black', { x: 0, y: 3 }, 'bp'),
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
    expect(result.state.pieces.find((p) => p.id === 'cq')?.pos).toEqual({ x: 0, y: 0 });
    expect(result.state.pieces.find((p) => p.id === 'bp')?.frozenTurns).toBe(1);
    expect(result.state.pieces.find((p) => p.id === 'cq')?.freezeCooldown).toBeGreaterThan(0);
    expect(result.events.some((e) => e.type === 'Frozen')).toBe(true);
    expect(getLegalMoves(result.state, { x: 0, y: 3 })).toHaveLength(0);
  });
});

describe('spearman', () => {
  it('captures one or two squares straight ahead', () => {
    const state = blankMatch([
      createPieceInstance('spearman', 'white', { x: 3, y: 1 }, 'sp'),
      createPieceInstance('pawn', 'black', { x: 3, y: 3 }, 'bp'),
      createPieceInstance('pawn', 'black', { x: 4, y: 2 }, 'bd'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const moves = getLegalMoves(state, { x: 3, y: 1 });
    expect(moves.some((m) => m.captures && m.to.x === 3 && m.to.y === 2)).toBe(false);
    expect(moves.some((m) => m.captures && m.to.x === 3 && m.to.y === 3)).toBe(true);
    expect(moves.some((m) => m.captures && m.to.x === 4 && m.to.y === 2)).toBe(false);

    const stateNear = blankMatch([
      createPieceInstance('spearman', 'white', { x: 3, y: 1 }, 'sp'),
      createPieceInstance('pawn', 'black', { x: 3, y: 2 }, 'bp'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const near = getLegalMoves(stateNear, { x: 3, y: 1 });
    expect(near.some((m) => m.captures && m.to.x === 3 && m.to.y === 2)).toBe(true);
  });
});

describe('sentry rook', () => {
  it('moves one step and has negative cost', () => {
    expect(getPieceDefinition('sentry').cost).toBe(-2);
    const state = blankMatch([
      createPieceInstance('sentry', 'white', { x: 0, y: 0 }, 'sr'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const moves = getLegalMoves(state, { x: 0, y: 0 });
    expect(
      moves.every((m) => Math.max(Math.abs(m.to.x - 0), Math.abs(m.to.y - 0)) <= 1),
    ).toBe(true);
    expect(moves.some((m) => m.to.x === 0 && m.to.y === 2)).toBe(false);
  });
});

describe('exchanger allySwap', () => {
  it('swaps once with an ally on a diagonal ray', () => {
    const state = blankMatch([
      createPieceInstance('exchanger', 'white', { x: 2, y: 0 }, 'ex'),
      createPieceInstance('pawn', 'white', { x: 4, y: 2 }, 'pw'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const moves = getLegalMoves(state, { x: 2, y: 0 });
    expect(moves.some((m) => m.abilityId === 'allySwap' && m.to.x === 4 && m.to.y === 2)).toBe(
      true,
    );
    const result = applyCommand(state, {
      type: 'move',
      from: { x: 2, y: 0 },
      to: { x: 4, y: 2 },
      abilityId: 'allySwap',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pieces.find((p) => p.id === 'ex')?.pos).toEqual({ x: 4, y: 2 });
    expect(result.state.pieces.find((p) => p.id === 'pw')?.pos).toEqual({ x: 2, y: 0 });
    expect(result.state.pieces.find((p) => p.id === 'ex')?.abilitiesUsed.allySwap).toBe(true);
  });
});
