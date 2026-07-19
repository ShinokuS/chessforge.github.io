import { describe, expect, it } from 'vitest';
import {
  DECK_COST_CAP,
  FORMATION_SLOTS,
  createMatch,
  createPieceInstance,
  createRectBoard,
  deckCost,
  getFormationSlot,
  getPieceDefinition,
  resetPieceIdCounter,
  withTileOverrides,
} from '@chessforge/engine';
import { buildAiDeck, chooseCommand, evaluate, hashPosition } from '../src/index.js';

function blank(
  pieces: ReturnType<typeof createPieceInstance>[],
  overrides: { pos: { x: number; y: number }; tileId: string }[] = [],
  activePlayer: 'white' | 'black' = 'white',
) {
  resetPieceIdCounter(1);
  const board = withTileOverrides(createRectBoard(8, 8, 'plain'), overrides);
  return createMatch({ board, pieces, activePlayer });
}

describe('evaluate', () => {
  it('prefers side with extra rook', () => {
    const richer = blank([
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const poorer = blank([
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    expect(evaluate(richer, 'white')).toBeGreaterThan(evaluate(poorer, 'white'));
  });

  it('likes enemy on spikes with grace nearly spent', () => {
    const safe = blank([
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('rook', 'black', { x: 0, y: 3 }, 'rb'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const spiked = blank(
      [
        createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
        createPieceInstance('rook', 'black', { x: 0, y: 3 }, 'rb'),
        createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      ],
      [{ pos: { x: 0, y: 3 }, tileId: 'spikes' }],
    );
    const enemy = spiked.pieces.find((p) => p.id === 'rb')!;
    enemy.spikeArmed = true;
    enemy.spikeTicks = 1;
    expect(evaluate(spiked, 'white')).toBeGreaterThan(evaluate(safe, 'white'));
  });

  it('values frozen enemy and ready cryomancer', () => {
    const base = blank([
      createPieceInstance('cryomancer', 'white', { x: 0, y: 0 }, 'cq'),
      createPieceInstance('rook', 'black', { x: 2, y: 2 }, 'rb'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const frozen = blank([
      createPieceInstance('cryomancer', 'white', { x: 0, y: 0 }, 'cq'),
      createPieceInstance('rook', 'black', { x: 2, y: 2 }, 'rb'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    frozen.pieces.find((p) => p.id === 'rb')!.frozenTurns = 1;
    expect(evaluate(frozen, 'white')).toBeGreaterThan(evaluate(base, 'white'));
  });

  it('penalizes own freeze cooldown', () => {
    const ready = blank([
      createPieceInstance('cryomancer', 'white', { x: 0, y: 0 }, 'cq'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const cooling = blank([
      createPieceInstance('cryomancer', 'white', { x: 0, y: 0 }, 'cq'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    cooling.pieces.find((p) => p.id === 'cq')!.freezeCooldown = 3;
    expect(evaluate(ready, 'white')).toBeGreaterThan(evaluate(cooling, 'white'));
  });
});

describe('hashPosition', () => {
  it('changes when side to move or piece moves', () => {
    const a = blank([
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const b = blank(
      [
        createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      ],
      [],
      'black',
    );
    expect(hashPosition(a)).not.toBe(hashPosition(b));
  });
});

describe('chooseCommand', () => {
  it('captures hanging queen', () => {
    const state = blank([
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw'),
      createPieceInstance('queen', 'black', { x: 0, y: 4 }, 'qb'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const cmd = chooseCommand(state, { maxDepth: 3, timeMs: 200, nodeLimit: 20_000 });
    expect(cmd.type).toBe('move');
    if (cmd.type !== 'move') return;
    expect(cmd.to).toEqual({ x: 0, y: 4 });
  });

  it('freezes a piece that threatens the king', () => {
    // Knight attacks trapped king; cryomancer must freeze it (qsearch sees mate).
    const state = blank(
      [
        createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
        createPieceInstance('cryomancer', 'white', { x: 3, y: 3 }, 'cq'),
        createPieceInstance('knight', 'black', { x: 1, y: 2 }, 'nb'),
        createPieceInstance('king', 'black', { x: 7, y: 7 }, 'kb'),
      ],
      [
        { pos: { x: 0, y: 1 }, tileId: 'lake' },
        { pos: { x: 1, y: 0 }, tileId: 'lake' },
        { pos: { x: 1, y: 1 }, tileId: 'lake' },
      ],
    );
    // Depth ≥3 sees delayed mate after freeze expires — mate-distance must prefer freeze.
    const cmd = chooseCommand(state, { maxDepth: 4, timeMs: 2000, nodeLimit: 200_000 });
    expect(cmd.type).toBe('move');
    if (cmd.type !== 'move') return;
    expect(cmd.from).toEqual({ x: 3, y: 3 });
    expect(cmd.to).toEqual({ x: 1, y: 2 });
  });

  it('does not trade queen for a protected pawn when a hanging knight exists', () => {
    const state = blank([
      createPieceInstance('queen', 'white', { x: 3, y: 3 }, 'qw'),
      createPieceInstance('pawn', 'black', { x: 3, y: 4 }, 'bp'),
      createPieceInstance('rook', 'black', { x: 3, y: 7 }, 'rb'),
      createPieceInstance('knight', 'black', { x: 0, y: 3 }, 'nb'),
      createPieceInstance('king', 'white', { x: 6, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 6, y: 7 }, 'kb'),
    ]);
    const cmd = chooseCommand(state, { maxDepth: 3, timeMs: 500, nodeLimit: 50_000 });
    expect(cmd.type).toBe('move');
    if (cmd.type !== 'move') return;
    expect(cmd.to).toEqual({ x: 0, y: 3 });
    expect(cmd.to).not.toEqual({ x: 3, y: 4 });
  });

  it('leaves spikes when grace is nearly spent', () => {
    const state = blank(
      [
        createPieceInstance('rook', 'white', { x: 0, y: 1 }, 'rw'),
        createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
        createPieceInstance('pawn', 'black', { x: 6, y: 6 }, 'bp'),
        createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      ],
      [{ pos: { x: 0, y: 1 }, tileId: 'spikes' }],
    );
    const rook = state.pieces.find((p) => p.id === 'rw')!;
    rook.spikeArmed = true;
    rook.spikeTicks = 1;
    const cmd = chooseCommand(state, { maxDepth: 3, timeMs: 250, nodeLimit: 25_000 });
    expect(cmd.type).toBe('move');
    if (cmd.type !== 'move') return;
    expect(cmd.from).toEqual({ x: 0, y: 1 });
    expect(cmd.to).not.toEqual({ x: 0, y: 1 });
  });

  it('sees a hanging queen even in a crowded middlegame', () => {
    const extras: ReturnType<typeof createPieceInstance>[] = [];
    // Leave a-file open so the rook can take the queen on a5.
    for (let x = 1; x < 8; x++) {
      extras.push(createPieceInstance('pawn', 'white', { x, y: 1 }, `wp${x}`));
    }
    for (let x = 0; x < 8; x++) {
      extras.push(createPieceInstance('pawn', 'black', { x, y: 6 }, `bp${x}`));
    }
    const state = blank([
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw'),
      createPieceInstance('knight', 'white', { x: 1, y: 0 }, 'nw'),
      createPieceInstance('bishop', 'white', { x: 2, y: 0 }, 'bw'),
      createPieceInstance('queen', 'black', { x: 0, y: 4 }, 'qb'),
      createPieceInstance('knight', 'black', { x: 1, y: 7 }, 'nb'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      ...extras,
    ]);
    expect(state.pieces.length).toBeGreaterThan(20);
    const cmd = chooseCommand(state, { maxDepth: 3, timeMs: 800, nodeLimit: 80_000 });
    expect(cmd.type).toBe('move');
    if (cmd.type !== 'move') return;
    expect(cmd.to).toEqual({ x: 0, y: 4 });
  });

  it('captures an exposed king instead of a free pawn', () => {
    const state = blank([
      createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw'),
      createPieceInstance('pawn', 'black', { x: 7, y: 1 }, 'bp'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 0, y: 4 }, 'kb'),
    ]);
    const cmd = chooseCommand(state, { maxDepth: 2, timeMs: 200, nodeLimit: 20_000 });
    expect(cmd.type).toBe('move');
    if (cmd.type !== 'move') return;
    expect(cmd.to).toEqual({ x: 0, y: 4 });
  });

  it('moves the king out of lethal threat instead of snacking', () => {
    // Black rook eyes white king on the a-file; white could take a free pawn on h7
    // but must step off the file or block.
    const state = blank([
      createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
      createPieceInstance('pawn', 'black', { x: 7, y: 6 }, 'bp'),
      createPieceInstance('rook', 'white', { x: 7, y: 0 }, 'rw'),
      createPieceInstance('rook', 'black', { x: 0, y: 7 }, 'rb'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const cmd = chooseCommand(state, { maxDepth: 3, timeMs: 500, nodeLimit: 60_000 });
    expect(cmd.type).toBe('move');
    if (cmd.type !== 'move') return;
    // Must not leave the king on a1 (en prise to the rook).
    const stillOnA1 = cmd.from.x === 0 && cmd.from.y === 0 && cmd.to.x === 0 && cmd.to.y === 0;
    expect(stillOnA1).toBe(false);
    // Prefer moving the king (or capturing the rook if possible) over hxg? taking pawn.
    expect(cmd.to).not.toEqual({ x: 7, y: 6 });
  });
});

describe('buildAiDeck', () => {
  it('fills all slots within cost cap with valid roles', () => {
    const deck = buildAiDeck(42);
    expect(deck).toHaveLength(FORMATION_SLOTS.length);
    expect(deckCost(deck)).toBeLessThanOrEqual(DECK_COST_CAP);
    for (const p of deck) {
      const slot = getFormationSlot(p.slotId);
      const def = getPieceDefinition(p.defId);
      expect(def.baseRole).toBe(slot.role);
    }
  });

  it('varies composition across seeds', () => {
    const a = buildAiDeck(1)
      .map((p) => p.defId)
      .join(',');
    const b = buildAiDeck(99)
      .map((p) => p.defId)
      .join(',');
    const c = buildAiDeck(12345)
      .map((p) => p.defId)
      .join(',');
    const unique = new Set([a, b, c]);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('usually spends most of the cost cap', () => {
    const costs = [1, 7, 42, 99, 256, 1024, 9999, 12345].map((s) => deckCost(buildAiDeck(s)));
    const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
    expect(avg).toBeGreaterThanOrEqual(7);
    expect(Math.max(...costs)).toBeGreaterThanOrEqual(9);
  });
});
