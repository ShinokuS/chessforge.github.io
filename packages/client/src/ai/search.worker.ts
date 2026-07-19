/// <reference lib="webworker" />
import {
  chooseCommand,
  scoreRootMoves,
  searchPosition,
  searchScoreCommand,
  searchScoreWhiteAfter,
  type ChooseOptions,
  type SearchResult,
} from '@chessforge/ai';
import type { GameCommand, LegalMove, MatchState } from '@chessforge/engine';

export type WorkerRequest =
  | {
      id: number;
      type: 'choose';
      state: MatchState;
      options: ChooseOptions;
    }
  | {
      id: number;
      type: 'scoreRoots';
      state: MatchState;
      moves: LegalMove[];
      depth: number;
      options: ChooseOptions;
    }
  | {
      id: number;
      type: 'searchPosition';
      state: MatchState;
      options: ChooseOptions;
    }
  | {
      id: number;
      type: 'scoreCommand';
      state: MatchState;
      command: GameCommand;
      options: ChooseOptions;
    }
  | {
      id: number;
      type: 'scoreWhiteAfter';
      state: MatchState;
      command: GameCommand;
      options: ChooseOptions;
    };

export type WorkerResponse =
  | { id: number; type: 'choose'; command: GameCommand }
  | {
      id: number;
      type: 'scoreRoots';
      results: Array<{ move: LegalMove; score: number }>;
      completed: boolean;
    }
  | { id: number; type: 'searchPosition'; result: SearchResult }
  | { id: number; type: 'scoreCommand'; score: number }
  | { id: number; type: 'scoreWhiteAfter'; score: number }
  | { id: number; type: 'error'; message: string };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'choose': {
        const command = chooseCommand(msg.state, msg.options);
        const res: WorkerResponse = { id: msg.id, type: 'choose', command };
        self.postMessage(res);
        break;
      }
      case 'scoreRoots': {
        const { results, completed } = scoreRootMoves(
          msg.state,
          msg.moves,
          msg.depth,
          msg.options,
        );
        const res: WorkerResponse = {
          id: msg.id,
          type: 'scoreRoots',
          results,
          completed,
        };
        self.postMessage(res);
        break;
      }
      case 'searchPosition': {
        const result = searchPosition(msg.state, msg.options);
        const res: WorkerResponse = { id: msg.id, type: 'searchPosition', result };
        self.postMessage(res);
        break;
      }
      case 'scoreCommand': {
        const score = searchScoreCommand(msg.state, msg.command, msg.options);
        const res: WorkerResponse = { id: msg.id, type: 'scoreCommand', score };
        self.postMessage(res);
        break;
      }
      case 'scoreWhiteAfter': {
        const score = searchScoreWhiteAfter(msg.state, msg.command, msg.options);
        const res: WorkerResponse = { id: msg.id, type: 'scoreWhiteAfter', score };
        self.postMessage(res);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    const res: WorkerResponse = {
      id: msg.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(res);
  }
};
