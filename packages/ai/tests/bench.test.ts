import { describe, expect, it } from 'vitest';
import { runAiBench } from '../src/bench.js';

describe('deterministic benchmark gate', () => {
  it('solves the tactical baseline with the Stockfish engine', () => {
    const rows = runAiBench({
      maxDepth: 3,
      timeMs: 500,
      nodeLimit: 80_000,
      ttBits: 16,
    });
    const hanging = rows.find((row) => row.name === 'hanging-queen');
    const royal = rows.find((row) => row.name === 'royal-capture');

    expect(hanging?.engine).toBe('stockfish');
    expect(hanging?.command.type).toBe('move');
    if (hanging?.command.type === 'move') {
      expect(hanging.command.to).toEqual({ x: 0, y: 4 });
    }
    expect(royal?.command.type).toBe('move');
    if (royal?.command.type === 'move') {
      expect(royal.command.to).toEqual({ x: 0, y: 4 });
    }
    expect(rows.every((row) => row.nodes >= 0 && row.elapsedMs >= 0)).toBe(true);
  });
});
