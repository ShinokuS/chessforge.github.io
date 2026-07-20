import { describe, expect, it } from 'vitest';
import {
  createMatch,
  createPieceInstance,
  createRectBoard,
  applyCommand,
  resetPieceIdCounter,
} from '../src/index.js';
import { formatEventsToHistory, appendHistoryFromEvents, groupHistoryForDisplay, assignDisplayTurns, historyTextForViewer } from '../src/index.js';

function blank(pieces: ReturnType<typeof createPieceInstance>[]) {
  resetPieceIdCounter(1);
  return createMatch({ board: createRectBoard(8, 8, 'plain'), pieces });
}

describe('formatEventsToHistory', () => {
  it('keeps one ply for a move + passive cleric heal', () => {
    const state = blank([
      createPieceInstance('cleric', 'white', { x: 4, y: 1 }, 'cw'),
      createPieceInstance('knight', 'white', { x: 2, y: 2 }, 'nw'),
      createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const result = applyCommand(state, {
      type: 'move',
      from: { x: 2, y: 2 },
      to: { x: 4, y: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entries = formatEventsToHistory(result.events, result.state, 1);
    expect(entries.filter((e) => e.kind === 'ply')).toHaveLength(1);
    expect(entries[0]?.player).toBe('white');
    expect(entries[0]?.text).toMatch(/Конь/);
    expect(entries[0]?.text).toMatch(/лечение/i);
    expect(entries[0]?.turn).toBe(1);
  });

  it('records ability turns (shield / curse) as single plies', () => {
    const state = blank([
      createPieceInstance('aegis', 'white', { x: 0, y: 0 }, 'aw'),
      createPieceInstance('queen', 'white', { x: 3, y: 0 }, 'qw'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    const result = applyCommand(state, {
      type: 'move',
      from: { x: 0, y: 0 },
      to: { x: 3, y: 0 },
      abilityId: 'grantShield',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entries = formatEventsToHistory(result.events, result.state, 1);
    expect(entries.filter((e) => e.kind === 'ply')).toHaveLength(1);
    expect(entries[0]?.text).toMatch(/Щит/);
  });

  it('pairs skip + opponent move on the same turn row', () => {
    const skip = {
      ply: 1,
      turn: 1,
      player: 'white' as const,
      text: 'Промедление: пропуск первого хода',
      kind: 'ply' as const,
    };
    const state = blank([
      createPieceInstance('pawn', 'black', { x: 3, y: 6 }, 'pb'),
      createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
    ]);
    state.activePlayer = 'black';
    const result = applyCommand(state, {
      type: 'move',
      from: { x: 3, y: 6 },
      to: { x: 3, y: 5 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const blackEntries = formatEventsToHistory(result.events, result.state, 2);
    const all = [...[skip], ...blackEntries];
    const blocks = groupHistoryForDisplay(all);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('turn');
    if (blocks[0]?.type !== 'turn') return;
    expect(blocks[0].row.white?.text).toMatch(/Промедление/);
    expect(blocks[0].row.black?.text).toMatch(/Пешка/);
  });

  it('does not let passive heal overwrite the real move in the turn row', () => {
    const state = blank([
      createPieceInstance('cleric', 'white', { x: 4, y: 1 }, 'cw'),
      createPieceInstance('knight', 'white', { x: 2, y: 2 }, 'nw'),
      createPieceInstance('pawn', 'black', { x: 0, y: 6 }, 'pb'),
      createPieceInstance('king', 'white', { x: 7, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 7, y: 7 }, 'kb'),
    ]);

    const white = applyCommand(state, {
      type: 'move',
      from: { x: 2, y: 2 },
      to: { x: 4, y: 3 },
    });
    expect(white.ok).toBe(true);
    if (!white.ok) return;
    const wEntries = formatEventsToHistory(white.events, white.state, 1);

    const black = applyCommand(white.state, {
      type: 'move',
      from: { x: 0, y: 6 },
      to: { x: 0, y: 5 },
    });
    expect(black.ok).toBe(true);
    if (!black.ok) return;
    const bEntries = formatEventsToHistory(black.events, black.state, 2);

    const blocks = groupHistoryForDisplay([...wEntries, ...bEntries]);
    expect(blocks).toHaveLength(1);
    if (blocks[0]?.type !== 'turn') return;
    expect(blocks[0].row.white?.text).toMatch(/Конь/);
    expect(blocks[0].row.white?.text).not.toBe('Лечение Конь (2 HP)');
    expect(blocks[0].row.black?.text).toMatch(/Пешка/);
  });

  it('merges wayfarer double-move halves into one ply so black pairs on the same turn', () => {
    const state = blank([
      createPieceInstance('wayfarer', 'white', { x: 2, y: 2 }, 'wb'),
      createPieceInstance('pawn', 'black', { x: 0, y: 6 }, 'pb'),
      createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 7, y: 7 }, 'kb'),
    ]);

    const first = applyCommand(state, {
      type: 'move',
      from: { x: 2, y: 2 },
      to: { x: 4, y: 4 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.extraMovePieceId).toBe('wb');

    let history = appendHistoryFromEvents([], first.events, first.state);
    expect(history.filter((e) => e.kind === 'ply')).toHaveLength(1);

    const second = applyCommand(first.state, {
      type: 'move',
      from: { x: 4, y: 4 },
      to: { x: 6, y: 6 },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    history = appendHistoryFromEvents(history, second.events, second.state, {
      continueExtraMove: true,
    });
    expect(history.filter((e) => e.kind === 'ply')).toHaveLength(1);
    expect(history[0]?.text).toMatch(/Странник/);
    expect(history[0]?.text).toMatch(/c3→e5/);
    expect(history[0]?.text).toMatch(/e5→g7/);
    expect(history[0]?.turn).toBe(1);

    const black = applyCommand(second.state, {
      type: 'move',
      from: { x: 0, y: 6 },
      to: { x: 0, y: 5 },
    });
    expect(black.ok).toBe(true);
    if (!black.ok) return;

    history = appendHistoryFromEvents(history, black.events, black.state);
    const blocks = groupHistoryForDisplay(history);
    expect(blocks).toHaveLength(1);
    if (blocks[0]?.type !== 'turn') return;
    expect(blocks[0].row.turn).toBe(1);
    expect(blocks[0].row.white?.text).toMatch(/Странник/);
    expect(blocks[0].row.black?.text).toMatch(/Пешка/);
  });

  it('keeps pairing after declining the wayfarer second half with endTurn', () => {
    const state = blank([
      createPieceInstance('wayfarer', 'white', { x: 2, y: 2 }, 'wb'),
      createPieceInstance('pawn', 'black', { x: 0, y: 6 }, 'pb'),
      createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 7, y: 7 }, 'kb'),
    ]);

    const first = applyCommand(state, {
      type: 'move',
      from: { x: 2, y: 2 },
      to: { x: 4, y: 4 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    let history = appendHistoryFromEvents([], first.events, first.state);

    const pass = applyCommand(first.state, { type: 'endTurn' });
    expect(pass.ok).toBe(true);
    if (!pass.ok) return;
    expect(pass.state.pieces.find((p) => p.id === 'wb')?.abilitiesUsed.doubleMove).toBeFalsy();

    history = appendHistoryFromEvents(history, pass.events, pass.state, {
      continueExtraMove: true,
    });
    expect(history.filter((e) => e.kind === 'ply')).toHaveLength(1);

    const black = applyCommand(pass.state, {
      type: 'move',
      from: { x: 0, y: 6 },
      to: { x: 0, y: 5 },
    });
    expect(black.ok).toBe(true);
    if (!black.ok) return;

    history = appendHistoryFromEvents(history, black.events, black.state);
    const blocks = groupHistoryForDisplay(history);
    expect(blocks).toHaveLength(1);
    if (blocks[0]?.type !== 'turn') return;
    expect(blocks[0].row.white?.text).toMatch(/Странник/);
    expect(blocks[0].row.black?.text).toMatch(/Пешка/);
  });

  it('assignDisplayTurns keeps same-side continuations on one turn row', () => {
    expect(assignDisplayTurns(['white', 'white', 'black'])).toEqual([1, 1, 1]);
    expect(assignDisplayTurns(['white', 'black', 'white', 'black'])).toEqual([1, 1, 2, 2]);
    expect(assignDisplayTurns(['black', 'white', 'black'])).toEqual([1, 2, 2]);
  });

  it('hides cloaked pawn moves from the opponent until the cloak expires', () => {
    const state = blank([
      createPieceInstance('veilqueen', 'white', { x: 3, y: 0 }, 'vq'),
      createPieceInstance('pawn', 'white', { x: 4, y: 1 }, 'pw'),
      createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 7, y: 7 }, 'kb'),
    ]);

    const cloak = applyCommand(state, {
      type: 'move',
      from: { x: 3, y: 0 },
      to: { x: 4, y: 1 },
      abilityId: 'cloakPawn',
    });
    expect(cloak.ok).toBe(true);
    if (!cloak.ok) return;

    let history = appendHistoryFromEvents([], cloak.events, cloak.state);
    expect(history[0]?.cloakPieceId).toBe('pw');
    expect(historyTextForViewer(history[0]!, 'white', cloak.state)).toMatch(/Покров/);
    expect(historyTextForViewer(history[0]!, 'black', cloak.state)).toBe('Покров');

    cloak.state.activePlayer = 'white';
    const moved = applyCommand(cloak.state, {
      type: 'move',
      from: { x: 4, y: 1 },
      to: { x: 4, y: 2 },
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    history = appendHistoryFromEvents(history, moved.events, moved.state);
    const movePly = history[history.length - 1]!;
    expect(movePly.cloakPieceId).toBe('pw');
    expect(historyTextForViewer(movePly, 'white', moved.state)).toMatch(/Пешка/);
    expect(historyTextForViewer(movePly, 'black', moved.state)).toBe('???');

    // Expire cloak.
    const revealed = structuredClone(moved.state);
    const pawn = revealed.pieces.find((p) => p.id === 'pw');
    if (pawn) pawn.invisibleTurns = 0;
    expect(historyTextForViewer(movePly, 'black', revealed)).toMatch(/Пешка/);
  });
});
