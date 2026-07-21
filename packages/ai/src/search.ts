import { applyCommand, type GameCommand, type LegalMove, type MatchState } from '@chessforge/engine';
import {
  chooseLegacy,
  chooseLegacyAsync,
  getBot,
  searchLegacyPosition,
} from './bots/index.js';
import {
  INF,
  type FullSearchResult,
  type SearchOptions,
} from './search/model.js';

export type ChooseOptions = SearchOptions;
export type SearchResult = FullSearchResult;

function resolveBot(options: ChooseOptions) {
  return getBot(options.engine);
}

/**
 * Prefer the selected bot; on unexpected throw fall back to legacy
 * (preserves previous stockfish→legacy safety net when bot is stockfish).
 */
function withLegacyFallback<T>(options: ChooseOptions, run: () => T, fallback: () => T): T {
  if (options.engine === 'legacy') return run();
  try {
    return run();
  } catch {
    return fallback();
  }
}

export function chooseCommand(
  state: MatchState,
  options: ChooseOptions = {},
): GameCommand {
  const bot = resolveBot(options);
  return withLegacyFallback(
    options,
    () => bot.choose(state, options),
    () => chooseLegacy(state, options),
  );
}

export async function chooseCommandAsync(
  state: MatchState,
  options: ChooseOptions = {},
): Promise<GameCommand> {
  const bot = resolveBot(options);
  return withLegacyFallback(
    options,
    () =>
      bot.chooseAsync
        ? bot.chooseAsync(state, options)
        : Promise.resolve(bot.choose(state, options)),
    () => chooseLegacyAsync(state, options),
  );
}

export function scoreRootMoves(
  state: MatchState,
  moves: LegalMove[],
  depth: number,
  options: ChooseOptions = {},
): { results: Array<{ move: LegalMove; score: number }>; completed: boolean } {
  const bot = resolveBot(options);
  return withLegacyFallback(
    options,
    () => {
      if (!bot.scoreRoots) {
        // Sequential score via search of each child — rare path for bots without rootSplit.
        const results: Array<{ move: LegalMove; score: number }> = [];
        for (const move of moves) {
          const cmd: GameCommand = {
            type: 'move',
            from: { ...move.from },
            to: { ...move.to },
            ...(move.abilityId !== undefined ? { abilityId: move.abilityId } : {}),
            ...(move.push ? { push: true } : {}),
          };
          const score = bot.scoreCommand
            ? bot.scoreCommand(state, cmd, { ...options, maxDepth: depth, depth })
            : bot.search(state, { ...options, maxDepth: depth, depth }).score;
          results.push({ move, score });
        }
        return { results, completed: true };
      }
      return bot.scoreRoots(state, moves, depth, options);
    },
    () => {
      const legacy = getBot('legacy');
      return legacy.scoreRoots!(state, moves, depth, { ...options, engine: 'legacy' });
    },
  );
}

export function searchPosition(
  state: MatchState,
  options: ChooseOptions = {},
  onIteration?: (partial: SearchResult) => void,
): SearchResult {
  const bot = resolveBot(options);
  return withLegacyFallback(
    options,
    () => bot.search(state, options, onIteration),
    () => searchLegacyPosition(state, options),
  );
}

export function searchScoreCommand(
  state: MatchState,
  command: GameCommand,
  options: ChooseOptions = {},
): number {
  const bot = resolveBot(options);
  return withLegacyFallback(
    options,
    () => {
      if (bot.scoreCommand) return bot.scoreCommand(state, command, options);
      return bot.search(state, options).score;
    },
    () => getBot('legacy').scoreCommand!(state, command, { ...options, engine: 'legacy' }),
  );
}

export function searchScoreWhiteAfter(
  state: MatchState,
  command: GameCommand,
  options: ChooseOptions = {},
): number {
  const bot = resolveBot(options);
  return withLegacyFallback(
    options,
    () => {
      if (bot.scoreWhiteAfter) return bot.scoreWhiteAfter(state, command, options);
      const applied = applyCommand(state, command);
      if (!applied.ok) return state.activePlayer === 'white' ? -INF : INF;
      return bot.search(applied.state, options).scoreWhite;
    },
    () =>
      getBot('legacy').scoreWhiteAfter!(state, command, { ...options, engine: 'legacy' }),
  );
}
