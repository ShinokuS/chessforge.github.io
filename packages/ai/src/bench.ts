import {
  createDemoMatch,
  createMatch,
  createPieceInstance,
  createRectBoard,
  type MatchState,
} from '@chessforge/engine';
import { searchPosition, type ChooseOptions, type SearchResult } from './search.js';

export type BenchCase = {
  name: string;
  state: MatchState;
};

export type BenchRow = {
  name: string;
  engine: 'stockfish' | 'legacy';
  command: SearchResult['best'];
  score: number;
  depth: number;
  nodes: number;
  nps: number;
  elapsedMs: number;
};

type InstrumentedResult = SearchResult & {
  depth?: number;
  nodes?: number;
  nps?: number;
  elapsedMs?: number;
};

function tacticalCases(): BenchCase[] {
  const plain = () => createRectBoard(8, 8, 'plain');
  return [
    { name: 'demo', state: createDemoMatch() },
    {
      name: 'hanging-queen',
      state: createMatch({
        board: plain(),
        activePlayer: 'white',
        pieces: [
          createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw'),
          createPieceInstance('queen', 'black', { x: 0, y: 4 }, 'qb'),
          createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
          createPieceInstance('king', 'black', { x: 4, y: 7 }, 'kb'),
        ],
      }),
    },
    {
      name: 'royal-capture',
      state: createMatch({
        board: plain(),
        activePlayer: 'white',
        pieces: [
          createPieceInstance('rook', 'white', { x: 0, y: 0 }, 'rw'),
          createPieceInstance('pawn', 'black', { x: 7, y: 1 }, 'bp'),
          createPieceInstance('king', 'white', { x: 4, y: 0 }, 'kw'),
          createPieceInstance('king', 'black', { x: 0, y: 4 }, 'kb'),
        ],
      }),
    },
  ];
}

export function runAiBench(
  options: ChooseOptions & { compareLegacy?: boolean } = {},
): BenchRow[] {
  const engines: Array<'stockfish' | 'legacy'> = options.compareLegacy
    ? ['stockfish', 'legacy']
    : ['stockfish'];
  const rows: BenchRow[] = [];
  for (const fixture of tacticalCases()) {
    for (const engine of engines) {
      const started = performance.now();
      const result = searchPosition(fixture.state, {
        ...options,
        engine,
        skill: 10,
      } as ChooseOptions);
      const elapsedMs = performance.now() - started;
      const metrics = result as InstrumentedResult;
      const nodes = metrics.nodes ?? 0;
      rows.push({
        name: fixture.name,
        engine,
        command: result.best,
        score: result.score,
        depth: metrics.depth ?? options.maxDepth ?? options.depth ?? 0,
        nodes,
        nps: metrics.nps ?? (elapsedMs > 0 ? Math.round(nodes * 1000 / elapsedMs) : 0),
        elapsedMs: metrics.elapsedMs ?? elapsedMs,
      });
    }
  }
  return rows;
}

export function renderBench(rows: BenchRow[]): string {
  const lines = [
    'Chessforge AI benchmark',
    'case\tengine\tdepth\tnodes\tnps\tms\tscore\tmove',
  ];
  for (const row of rows) {
    lines.push(
      [
        row.name,
        row.engine,
        row.depth,
        row.nodes,
        row.nps,
        row.elapsedMs.toFixed(1),
        row.score,
        JSON.stringify(row.command),
      ].join('\t'),
    );
  }
  return lines.join('\n');
}
