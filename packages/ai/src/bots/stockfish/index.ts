import { applyCommand } from '@chessforge/engine';
import { INF, scoreWhite } from '../../search/model.js';
import type { Bot } from '../types.js';
import {
  chooseStockfish,
  chooseStockfishAsync,
  scoreCommandStockfish,
  scoreMovesStockfish,
  searchStockfish,
} from './search.js';

export const stockfishBot: Bot = {
  meta: {
    id: 'stockfish',
    label: 'Stockfish',
    description: 'Stockfish-style PVS / iterative deepening search',
    deprecated: true,
    capabilities: {
      rootSplit: true,
      lazySmp: true,
    },
  },
  choose: chooseStockfish,
  chooseAsync: chooseStockfishAsync,
  search: searchStockfish,
  scoreRoots: scoreMovesStockfish,
  scoreCommand(state, command, options) {
    const depth = options.maxDepth ?? options.depth ?? 4;
    return scoreCommandStockfish(state, command, depth, options).score;
  },
  scoreWhiteAfter(state, command, options) {
    const applied = applyCommand(state, command);
    if (!applied.ok) return state.activePlayer === 'white' ? -INF : INF;
    const result = searchStockfish(applied.state, options);
    return scoreWhite(applied.state, result.score);
  },
};

export {
  chooseStockfish,
  chooseStockfishAsync,
  scoreCommandStockfish,
  scoreMovesStockfish,
  searchStockfish,
};
