import { describe, expect, it } from 'vitest';
import { createPieceInstance } from '@chessforge/engine';
import {
  buildTreeHistory,
  createRootNode,
  pathMatchesMove,
  playAtPath,
} from '../src/analysis/analysisTree';
import { cloneMatch } from '../src/analysis/analysisHelpers';

function blank(pieces: ReturnType<typeof createPieceInstance>[]) {
  return {
    board: {
      width: 8,
      height: 8,
      tiles: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 'plain' as const)),
    },
    pieces,
    activePlayer: 'white' as const,
    turn: 1,
    phase: 'play' as const,
    winner: null,
    mode: 'custom' as const,
  };
}

describe('analysis tree history', () => {
  it('highlights both halves of a wayfarer turn', () => {
    const opening = blank([
      createPieceInstance('wayfarer', 'white', { x: 2, y: 2 }, 'wb'),
      createPieceInstance('pawn', 'black', { x: 0, y: 6 }, 'pb'),
      createPieceInstance('king', 'white', { x: 0, y: 0 }, 'kw'),
      createPieceInstance('king', 'black', { x: 7, y: 7 }, 'kb'),
    ]);
    let root = createRootNode(cloneMatch(opening));
    let path: number[] = [];
    let next = playAtPath(root, path, {
      type: 'move',
      from: { x: 2, y: 2 },
      to: { x: 4, y: 4 },
    });
    expect(next).not.toBeNull();
    root = next!.root;
    path = next!.path;
    const firstPath = [...path];
    next = playAtPath(root, path, {
      type: 'move',
      from: { x: 4, y: 4 },
      to: { x: 6, y: 6 },
    });
    expect(next).not.toBeNull();
    root = next!.root;
    path = next!.path;

    const blocks = buildTreeHistory(root);
    const row = blocks.find((b) => b.kind === 'row' && b.white?.label.includes('Странник'));
    expect(row?.kind).toBe('row');
    if (row?.kind !== 'row' || !row.white) return;
    expect(row.white.label).toMatch(/c3→e5/);
    expect(row.white.label).toMatch(/e5→g7/);
    expect(row.white.label).not.toMatch(/Странник.*Странник/);
    expect(pathMatchesMove(firstPath, row.white)).toBe(true);
    expect(pathMatchesMove(path, row.white)).toBe(true);
  });
});
