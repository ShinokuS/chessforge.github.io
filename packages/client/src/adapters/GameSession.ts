import { buildAiDeck, chooseCommand } from '@chessforge/ai';
import {
  applyCommand,
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

export function createMatchFromDeck(playerDeck: Deck, seed = Date.now()): MatchState {
  // Mix seed so AI deck and board seed both vary between matches
  const aiSeed = (seed ^ 0x9e3779b9) >>> 0;
  return createMatchFromPlacements(playerDeck.placements, buildAiDeck(aiSeed), seed);
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
  private aiDepth = 2;

  constructor(
    private readonly mode: SessionMode = 'offline-ai',
    initial?: MatchState,
  ) {
    this.state = initial ?? createDemoMatch();
  }

  getState(): MatchState {
    return this.state;
  }

  setAiDepth(depth: number): void {
    this.aiDepth = Math.max(1, Math.min(4, Math.floor(depth)));
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
    const depth = this.aiDepth;
    await new Promise((r) => setTimeout(r, depth <= 1 ? 180 : 280));
    if (this.state.phase !== 'play' || this.state.activePlayer !== 'black') {
      this.aiBusy = false;
      return;
    }
    const cmd = chooseCommand(this.state, { depth });
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

  /** End the match when a side runs out of clock time. */
  endByTimeout(winner: 'white' | 'black'): void {
    if (this.state.phase !== 'play') return;
    this.state = { ...this.state, phase: 'gameOver', winner };
    this.lastError = null;
    this.emit([]);
  }
}

export function pieceLabel(defId: string): string {
  try {
    return getPieceDefinition(defId).name;
  } catch {
    return defId;
  }
}
