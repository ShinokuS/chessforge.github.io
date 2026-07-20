import { applyCommand, type GameCommand, type LegalMove, type MatchState } from '@chessforge/engine';
import * as legacy from './legacySearch.js';
import {
  INF,
  scoreWhite,
  type FullSearchResult,
  type SearchOptions,
} from './search/model.js';
import {
  chooseStockfish,
  chooseStockfishAsync,
  scoreCommandStockfish,
  scoreMovesStockfish,
  searchStockfish,
} from './search/stockfish.js';

export type ChooseOptions = SearchOptions;
export type SearchResult = FullSearchResult;

function legacyOptions(options: ChooseOptions): legacy.ChooseOptions {
  const { engine: _engine, ...rest } = options;
  return rest;
}

function enrichLegacy(
  result: legacy.SearchResult,
  startedAt: number,
): SearchResult {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  return {
    ...result,
    pv: [result.best],
    depth: 0,
    selDepth: 0,
    nodes: 0,
    nps: 0,
    elapsedMs,
    stoppedBy: 'fallback',
  };
}

export function chooseCommand(
  state: MatchState,
  options: ChooseOptions = {},
): GameCommand {
  if (options.engine === 'legacy') {
    return legacy.chooseCommand(state, legacyOptions(options));
  }
  try {
    return chooseStockfish(state, options);
  } catch {
    return legacy.chooseCommand(state, legacyOptions(options));
  }
}

export async function chooseCommandAsync(
  state: MatchState,
  options: ChooseOptions = {},
): Promise<GameCommand> {
  if (options.engine === 'legacy') {
    return legacy.chooseCommandAsync(state, legacyOptions(options));
  }
  try {
    return await chooseStockfishAsync(state, options);
  } catch {
    return legacy.chooseCommandAsync(state, legacyOptions(options));
  }
}

export function scoreRootMoves(
  state: MatchState,
  moves: LegalMove[],
  depth: number,
  options: ChooseOptions = {},
): { results: Array<{ move: LegalMove; score: number }>; completed: boolean } {
  if (options.engine === 'legacy') {
    return legacy.scoreRootMoves(state, moves, depth, legacyOptions(options));
  }
  try {
    return scoreMovesStockfish(state, moves, depth, options);
  } catch {
    return legacy.scoreRootMoves(state, moves, depth, legacyOptions(options));
  }
}

export function searchPosition(
  state: MatchState,
  options: ChooseOptions = {},
  onIteration?: (partial: SearchResult) => void,
): SearchResult {
  const startedAt = Date.now();
  if (options.engine === 'legacy') {
    return enrichLegacy(
      legacy.searchPosition(state, legacyOptions(options)),
      startedAt,
    );
  }
  try {
    return searchStockfish(state, options, onIteration);
  } catch {
    return enrichLegacy(
      legacy.searchPosition(state, legacyOptions(options)),
      startedAt,
    );
  }
}

export function searchScoreCommand(
  state: MatchState,
  command: GameCommand,
  options: ChooseOptions = {},
): number {
  if (options.engine === 'legacy') {
    return legacy.searchScoreCommand(state, command, legacyOptions(options));
  }
  try {
    const depth = options.maxDepth ?? options.depth ?? 4;
    return scoreCommandStockfish(state, command, depth, options).score;
  } catch {
    return legacy.searchScoreCommand(state, command, legacyOptions(options));
  }
}

export function searchScoreWhiteAfter(
  state: MatchState,
  command: GameCommand,
  options: ChooseOptions = {},
): number {
  if (options.engine === 'legacy') {
    return legacy.searchScoreWhiteAfter(state, command, legacyOptions(options));
  }
  try {
    const applied = applyCommand(state, command);
    if (!applied.ok) return state.activePlayer === 'white' ? -INF : INF;
    const result = searchStockfish(applied.state, options);
    return scoreWhite(applied.state, result.score);
  } catch {
    return legacy.searchScoreWhiteAfter(state, command, legacyOptions(options));
  }
}
