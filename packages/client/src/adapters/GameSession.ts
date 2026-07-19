import { chooseCommand } from '@chessforge/ai';
import {
  applyCommand,
  classicBasePlacements,
  createDemoMatch,
  createMatchFromPlacements,
  getLegalMoves,
  getPieceDefinition,
  type GameCommand,
  type GameEvent,
  type MatchState,
} from '@chessforge/engine';
import type { Deck } from '../repositories/types.js';

export type SessionMode = 'offline-ai' | 'hotseat';

export type GameSessionListener = (snapshot: {
  state: MatchState;
  events: GameEvent[];
  lastError: string | null;
}) => void;

export function createMatchFromDeck(playerDeck: Deck, seed = 7): MatchState {
  return createMatchFromPlacements(
    playerDeck.placements,
    classicBasePlacements(),
    seed,
  );
}

/**
 * Owns MatchState. UI and AI both go through submitCommand.
 * Later: NetworkGameSession implements the same surface.
 */
export class GameSession {
  private state: MatchState;
  private listeners = new Set<GameSessionListener>();
  private lastError: string | null = null;
  private aiBusy = false;

  constructor(
    private readonly mode: SessionMode = 'offline-ai',
    initial?: MatchState,
  ) {
    this.state = initial ?? createDemoMatch();
  }

  getState(): MatchState {
    return this.state;
  }

  getLegalMovesFrom(from: { x: number; y: number }) {
    return getLegalMoves(this.state, from);
  }

  subscribe(listener: GameSessionListener): () => void {
    this.listeners.add(listener);
    listener({ state: this.state, events: [], lastError: this.lastError });
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(events: GameEvent[]): void {
    for (const l of this.listeners) {
      l({ state: this.state, events, lastError: this.lastError });
    }
  }

  submitCommand(command: GameCommand): boolean {
    const result = applyCommand(this.state, command);
    if (!result.ok) {
      this.lastError = result.message;
      this.emit([]);
      return false;
    }
    this.lastError = null;
    this.state = result.state;
    this.emit(result.events);

    if (
      this.mode === 'offline-ai' &&
      this.state.phase === 'play' &&
      this.state.activePlayer === 'black' &&
      !this.aiBusy
    ) {
      void this.runAi();
    }
    return true;
  }

  private async runAi(): Promise<void> {
    this.aiBusy = true;
    await new Promise((r) => setTimeout(r, 350));
    if (this.state.phase !== 'play' || this.state.activePlayer !== 'black') {
      this.aiBusy = false;
      return;
    }
    const cmd = chooseCommand(this.state);
    this.aiBusy = false;
    this.submitCommand(cmd);
  }

  restart(deck?: Deck): void {
    this.state = deck ? createMatchFromDeck(deck) : createDemoMatch();
    this.lastError = null;
    this.emit([]);
    if (this.mode === 'offline-ai' && this.state.activePlayer === 'black') {
      void this.runAi();
    }
  }
}

export function pieceLabel(defId: string): string {
  try {
    return getPieceDefinition(defId).name;
  } catch {
    return defId;
  }
}
