import type { GameCommand, MatchState } from '@chessforge/engine';
import type { FullSearchResult, SearchOptions } from '../../search/model.js';
import type { Bot } from '../types.js';
import * as legacy from './search.js';

function legacyOptions(options: SearchOptions): legacy.ChooseOptions {
  const {
    engine: _engine,
    fastAnalysis: _fast,
    startDepth: _start,
    depthSliceMs: _slice,
    workers: _workers,
    memoryMb: _mem,
    ...rest
  } = options;
  return rest;
}

function enrichLegacy(
  result: legacy.SearchResult,
  startedAt: number,
): FullSearchResult {
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

export const legacyBot: Bot = {
  meta: {
    id: 'legacy',
    label: 'Legacy',
    description: 'Simpler alpha-beta search (fallback / comparison)',
    deprecated: true,
    capabilities: {
      rootSplit: false,
      lazySmp: false,
    },
  },
  choose(state, options) {
    return legacy.chooseCommand(state, legacyOptions(options));
  },
  chooseAsync(state, options) {
    return legacy.chooseCommandAsync(state, legacyOptions(options));
  },
  search(state, options, _onIteration?) {
    const startedAt = Date.now();
    return enrichLegacy(legacy.searchPosition(state, legacyOptions(options)), startedAt);
  },
  scoreRoots(state, moves, depth, options) {
    return legacy.scoreRootMoves(state, moves, depth, legacyOptions(options));
  },
  scoreCommand(state, command, options) {
    return legacy.searchScoreCommand(state, command, legacyOptions(options));
  },
  scoreWhiteAfter(state, command, options) {
    return legacy.searchScoreWhiteAfter(state, command, legacyOptions(options));
  },
};

/** Run legacy search enriched to FullSearchResult (used as stockfish fallback). */
export function searchLegacyPosition(
  state: MatchState,
  options: SearchOptions = {},
): FullSearchResult {
  const startedAt = Date.now();
  return enrichLegacy(legacy.searchPosition(state, legacyOptions(options)), startedAt);
}

export function chooseLegacy(state: MatchState, options: SearchOptions = {}): GameCommand {
  return legacy.chooseCommand(state, legacyOptions(options));
}

export async function chooseLegacyAsync(
  state: MatchState,
  options: SearchOptions = {},
): Promise<GameCommand> {
  return legacy.chooseCommandAsync(state, legacyOptions(options));
}
