import { describe, expect, it } from 'vitest';
import {
  createDemoMatch,
  createMatch,
  createPieceInstance,
  createRectBoard,
  getLegalMoves,
} from '@chessforge/engine';
import { chooseCommand, getBot, listBots, searchPosition } from '../src/index.js';
import { analyzeDeferredPhysics, canNullMove } from '../src/bots/forgefish/dpa.js';
import { hpSee } from '../src/bots/forgefish/hpSee.js';
import { evaluateMid } from '../src/bots/forgefish/eval.js';

describe('Forgefish bot', () => {
  it('is registered with rootSplit and lazySmp', () => {
    const ids = listBots().map((b) => b.id);
    expect(ids).toContain('forgefish');
    const bot = getBot('forgefish');
    expect(bot.meta.label).toBe('Forgefish');
    expect(bot.meta.capabilities.rootSplit).toBe(true);
    expect(bot.meta.capabilities.lazySmp).toBe(true);
  });

  it('chooses a legal move on demo', () => {
    const state = createDemoMatch();
    const cmd = chooseCommand(state, {
      engine: 'forgefish',
      maxDepth: 3,
      timeMs: 400,
      nodeLimit: 80_000,
      skill: 10,
    });
    expect(cmd.type === 'endTurn' || cmd.type === 'move').toBe(true);
    if (cmd.type === 'move') {
      const legal = getLegalMoves(state);
      expect(
        legal.some(
          (m) =>
            m.from.x === cmd.from.x &&
            m.from.y === cmd.from.y &&
            m.to.x === cmd.to.x &&
            m.to.y === cmd.to.y,
        ),
      ).toBe(true);
    }
  });

  it('searchPosition reports depth and nodes', () => {
    const state = createDemoMatch();
    const result = searchPosition(state, {
      engine: 'forgefish',
      maxDepth: 4,
      timeMs: 800,
      nodeLimit: 200_000,
      skill: 10,
    });
    expect(result.depth).toBeGreaterThanOrEqual(1);
    expect(result.nodes).toBeGreaterThan(0);
    expect(result.best).toBeTruthy();
  });

  it('live analysis depth-slice climbs past depth 2', () => {
    const state = createDemoMatch();
    const seen: number[] = [];
    const result = searchPosition(
      state,
      {
        engine: 'forgefish',
        maxDepth: 10,
        timeMs: 0,
        nodeLimit: 5_000_000,
        skill: 10,
        fastAnalysis: true,
        startDepth: 1,
        depthSliceMs: 200,
        ttBits: 16,
      },
      (partial) => {
        seen.push(partial.depth);
      },
    );
    expect(Math.max(0, ...seen, result.depth)).toBeGreaterThanOrEqual(8);
    expect(result.depth).toBeGreaterThanOrEqual(8);
  });

  it('works on non-8×8 boards', () => {
    const state = createMatch({
      board: createRectBoard(6, 6, 'plain'),
      activePlayer: 'white',
      pieces: [
        createPieceInstance('king', 'white', { x: 2, y: 0 }, 'kw'),
        createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw'),
        createPieceInstance('king', 'black', { x: 2, y: 5 }, 'kb'),
        createPieceInstance('pawn', 'black', { x: 0, y: 4 }, 'bp'),
      ],
    });
    const result = searchPosition(state, {
      engine: 'forgefish',
      maxDepth: 3,
      timeMs: 300,
      nodeLimit: 50_000,
      skill: 10,
    });
    expect(result.depth).toBeGreaterThanOrEqual(1);
  });

  it('DPA blocks NMP when spikes are armed', () => {
    const state = createMatch({
      board: createRectBoard(8, 8, 'plain'),
      activePlayer: 'white',
      pieces: [
        createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
        createPieceInstance('pawn', 'white', { x: 3, y: 3 }, 'pw'),
      ],
    });
    // Arm spikes on a piece
    const pawn = state.pieces.find((p) => p.id === 'pw')!;
    pawn.spikeArmed = true;
    pawn.spikeTicks = 1;
    const dpa = analyzeDeferredPhysics(state);
    expect(dpa.hasDeferredThreats).toBe(true);
    expect(canNullMove(state, dpa)).toBe(false);
  });

  it('HP-SEE prefers royal capture', () => {
    const state = createMatch({
      board: createRectBoard(8, 8, 'plain'),
      activePlayer: 'white',
      pieces: [
        createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw'),
        createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 0, y: 4 }, 'kb'),
      ],
    });
    const move = getLegalMoves(state).find(
      (m) => m.to.x === 0 && m.to.y === 4 && m.captures,
    );
    expect(move).toBeTruthy();
    expect(hpSee(state, move!)).toBeGreaterThan(10_000);
  });

  it('MidEval differs from zero on asymmetric material', () => {
    const state = createMatch({
      board: createRectBoard(8, 8, 'plain'),
      activePlayer: 'white',
      pieces: [
        createPieceInstance('queen', 'white', { x: 3, y: 3 }, 'qw'),
        createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
        createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
      ],
    });
    expect(evaluateMid(state, 'white')).toBeGreaterThan(200);
  });
});
