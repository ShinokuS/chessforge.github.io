import { describe, expect, it } from 'vitest';
import {
  classifyByWinChance,
  winningChances,
} from '../src/analysis/moveJudgment';

describe('move judgment (Lichess win%)', () => {
  it('winningChances is ~0 at equal', () => {
    expect(winningChances(0)).toBeCloseTo(0, 5);
  });

  it('marks blunder on ≥0.30 drop (~−200 cp from equal)', () => {
    const { judgment, winDrop } = classifyByWinChance(0, -200, 'white', false);
    expect(winDrop).toBeGreaterThanOrEqual(0.3);
    expect(judgment).toBe('blunder');
  });

  it('marks mistake around 0.20 drop (~−112 cp from equal)', () => {
    const { judgment, winDrop } = classifyByWinChance(0, -112, 'white', false);
    expect(winDrop).toBeGreaterThanOrEqual(0.2);
    expect(winDrop).toBeLessThan(0.3);
    expect(judgment).toBe('mistake');
  });

  it('marks inaccuracy around 0.10 drop (~−55 cp from equal)', () => {
    const { judgment, winDrop } = classifyByWinChance(0, -55, 'white', false);
    expect(winDrop).toBeGreaterThanOrEqual(0.1);
    expect(winDrop).toBeLessThan(0.2);
    expect(judgment).toBe('inaccuracy');
  });

  it('same as best is best even with tiny drop', () => {
    const { judgment } = classifyByWinChance(20, 10, 'white', true);
    expect(judgment).toBe('best');
  });

  it('does not punish already-won positions for small cp loss', () => {
    const { judgment, winDrop } = classifyByWinChance(800, 600, 'white', false);
    expect(winDrop).toBeLessThan(0.1);
    expect(['best', 'excellent', 'good']).toContain(judgment);
  });

  it('black pov: rising white eval is a drop for black', () => {
    const { judgment } = classifyByWinChance(-50, 250, 'black', false);
    expect(judgment).toBe('blunder');
  });
});
