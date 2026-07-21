import type { GameCommand, LegalMove, MatchState } from '@chessforge/engine';
import type { FullSearchResult, SearchOptions } from '../search/model.js';

export type BotId = string;

export type BotCapabilities = {
  /** Parallel choose via scoreRoots (AiWorkerPool root-split). */
  rootSplit: boolean;
  /** Lazy SMP for analysis. */
  lazySmp: boolean;
};

export type BotMeta = {
  id: BotId;
  label: string;
  description: string;
  capabilities: BotCapabilities;
  /** Shown in selectors as outdated / for comparison only. */
  deprecated?: boolean;
};

export type Bot = {
  meta: BotMeta;
  choose(state: MatchState, options: SearchOptions): GameCommand;
  chooseAsync?(state: MatchState, options: SearchOptions): Promise<GameCommand>;
  search(
    state: MatchState,
    options: SearchOptions,
    onIteration?: (partial: FullSearchResult) => void,
  ): FullSearchResult;
  scoreRoots?(
    state: MatchState,
    moves: LegalMove[],
    depth: number,
    options: SearchOptions,
  ): { results: Array<{ move: LegalMove; score: number }>; completed: boolean };
  scoreCommand?(state: MatchState, command: GameCommand, options: SearchOptions): number;
  scoreWhiteAfter?(state: MatchState, command: GameCommand, options: SearchOptions): number;
};
