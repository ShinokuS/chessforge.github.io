import type { MatchState } from '@chessforge/engine';
import { hashPositionPair } from '../zobrist.js';
import { MATE } from './model.js';

export type Bound = 'exact' | 'lower' | 'upper';

type Entry = {
  key: number;
  checksum: number;
  depth: number;
  score: number;
  bound: Bound;
  moveKey: string | null;
  generation: number;
};

export type Probe = {
  hit: boolean;
  score: number;
  moveKey: string | null;
};

export type PositionId = {
  key: number;
  checksum: number;
};

function scoreToTable(score: number, ply: number): number {
  if (score > MATE - 10_000) return score + ply;
  if (score < -MATE + 10_000) return score - ply;
  return score;
}

function scoreFromTable(score: number, ply: number): number {
  if (score > MATE - 10_000) return score - ply;
  if (score < -MATE + 10_000) return score + ply;
  return score;
}

export class TranspositionTable {
  private readonly entries: Array<Entry | undefined>;
  private readonly mask: number;
  private generation = 0;

  constructor(bits: number) {
    const size = 1 << bits;
    this.entries = new Array<Entry | undefined>(size);
    this.mask = size - 1;
  }

  identify(state: MatchState): PositionId {
    const pair = hashPositionPair(state);
    return { key: pair.low, checksum: pair.high };
  }

  nextGeneration(): void {
    this.generation = (this.generation + 1) & 0xff;
  }

  probe(id: PositionId, depth: number, alpha: number, beta: number, ply = 0): Probe {
    const entry = this.entries[id.key & this.mask];
    if (!entry || entry.key !== id.key || entry.checksum !== id.checksum) {
      return { hit: false, score: 0, moveKey: null };
    }
    if (entry.depth < depth) {
      return { hit: false, score: 0, moveKey: entry.moveKey };
    }
    const score = scoreFromTable(entry.score, ply);
    if (
      entry.bound === 'exact' ||
      (entry.bound === 'lower' && score >= beta) ||
      (entry.bound === 'upper' && score <= alpha)
    ) {
      return { hit: true, score, moveKey: entry.moveKey };
    }
    return { hit: false, score: 0, moveKey: entry.moveKey };
  }

  store(
    id: PositionId,
    depth: number,
    score: number,
    bound: Bound,
    moveKey: string | null,
    ply = 0,
  ): void {
    const index = id.key & this.mask;
    const previous = this.entries[index];
    if (
      previous &&
      previous.generation === this.generation &&
      previous.depth > depth &&
      (previous.key !== id.key ||
        previous.checksum !== id.checksum ||
        bound !== 'exact')
    ) {
      return;
    }
    this.entries[index] = {
      ...id,
      depth,
      score: scoreToTable(score, ply),
      bound,
      moveKey,
      generation: this.generation,
    };
  }
}
