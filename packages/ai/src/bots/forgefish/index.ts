import { applyCommand } from '@chessforge/engine';
import { INF, scoreWhite } from '../../search/model.js';
import type { Bot } from '../types.js';
import {
  chooseForgefish,
  chooseForgefishAsync,
  scoreCommandForgefish,
  scoreMovesForgefish,
  searchForgefish,
} from './search.js';

export const forgefishBot: Bot = {
  meta: {
    id: 'forgefish',
    label: 'Forgefish',
    description:
      'Chessforge-native: HP-SEE, DPA-safe NMP, selective LMR; classic fast path when eligible',
    capabilities: {
      rootSplit: true,
      lazySmp: true,
    },
  },
  choose: chooseForgefish,
  chooseAsync: chooseForgefishAsync,
  search: searchForgefish,
  scoreRoots: scoreMovesForgefish,
  scoreCommand(state, command, options) {
    const depth = options.maxDepth ?? options.depth ?? 4;
    return scoreCommandForgefish(state, command, depth, options).score;
  },
  scoreWhiteAfter(state, command, options) {
    const applied = applyCommand(state, command);
    if (!applied.ok) return state.activePlayer === 'white' ? -INF : INF;
    const result = searchForgefish(applied.state, options);
    return scoreWhite(applied.state, result.score);
  },
};

export {
  chooseForgefish,
  chooseForgefishAsync,
  scoreCommandForgefish,
  scoreMovesForgefish,
  searchForgefish,
};
