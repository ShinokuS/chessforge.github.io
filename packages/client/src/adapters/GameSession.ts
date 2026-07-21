import { buildAiDeck, clampBotId, DEFAULT_BOT_ID, type BotId, type ChooseOptions } from '@chessforge/ai';
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
import { aiChooseOptions, clampAiStrength, type AiStrengthLevel } from '../battle/settings.js';
import { getAiPool } from '../ai/AiWorkerPool.js';

export type SessionMode = 'offline-ai' | 'hotseat';

export type GameSessionListener = (snapshot: {
  state: MatchState;
  events: GameEvent[];
  lastError: string | null;
}) => void;

export function createMatchFromDeck(playerDeck: Deck, seed = Date.now()): MatchState {
  const aiSeed = (seed ^ 0x9e3779b9) >>> 0;
  return createMatchFromPlacements(playerDeck.placements, buildAiDeck(aiSeed), seed);
}

/**
 * Owns MatchState. UI and AI both go through submitCommand.
 */
export class GameSession {
  private state: MatchState;
  private listeners = new Set<GameSessionListener>();
  private lastError: string | null = null;
  private aiBusy = false;
  private aiStrength: AiStrengthLevel = 6;
  private aiBotId: BotId = DEFAULT_BOT_ID;
  private aiOptions: ChooseOptions = aiChooseOptions(6, DEFAULT_BOT_ID);
  /** Position at match start (for post-game analysis). */
  private openingState: MatchState | null = null;
  /** Player/AI commands applied this match, in order. */
  private recordedCommands: GameCommand[] = [];

  constructor(
    private readonly mode: SessionMode = 'offline-ai',
    initial?: MatchState,
  ) {
    this.state = initial ?? createDemoMatch();
    this.openingState = cloneState(this.state);
  }

  getState(): MatchState {
    return this.state;
  }

  /** Replay data for computer analysis (AI games). */
  getReplay(): { opening: MatchState; commands: GameCommand[] } | null {
    if (!this.openingState) return null;
    return {
      opening: cloneState(this.openingState),
      commands: this.recordedCommands.map((c) => structuredClone(c)),
    };
  }

  /** @deprecated prefer setAiStrength(0–10) */
  setAiDepth(depth: number): void {
    const d = Math.max(1, Math.min(14, Math.floor(depth)));
    this.setAiStrength(Math.round((d / 14) * 10));
  }

  setAiStrength(strength: AiStrengthLevel): void {
    this.aiStrength = clampAiStrength(strength);
    this.refreshAiOptions();
  }

  setAiBot(botId: BotId): void {
    this.aiBotId = clampBotId(botId);
    this.refreshAiOptions();
  }

  private refreshAiOptions(): void {
    this.aiOptions = aiChooseOptions(this.aiStrength, this.aiBotId);
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
    // Record moves and explicit endTurn (Wayfarer declining the second half)
    // so post-game analysis can replay the exact sequence.
    if (command.type === 'move' || command.type === 'endTurn') {
      this.recordedCommands.push(structuredClone(command));
    }
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
    if (this.aiBusy) return;
    this.aiBusy = true;
    try {
      // Wayfarer (and similar) can keep the same side to move for a second action.
      // Loop until it's no longer black's turn — otherwise aiBusy blocks the follow-up.
      while (
        this.mode === 'offline-ai' &&
        this.state.phase === 'play' &&
        this.state.activePlayer === 'black'
      ) {
        const opts = { ...this.aiOptions };
        // Let React paint before workers spin up.
        await new Promise((r) => setTimeout(r, 16));
        if (this.state.phase !== 'play' || this.state.activePlayer !== 'black') break;
        try {
          const cmd = await getAiPool().chooseCommand(this.state, opts);
          if (this.state.phase !== 'play' || this.state.activePlayer !== 'black') break;
          const ok = this.submitCommand(cmd);
          if (!ok) break;
        } catch (err) {
          console.error('AI search failed', err);
          this.lastError = 'ИИ не смог сделать ход';
          this.emit([]);
          break;
        }
      }
    } finally {
      this.aiBusy = false;
    }
  }

  restart(deck?: Deck): void {
    this.state = deck ? createMatchFromDeck(deck) : createDemoMatch();
    this.lastError = null;
    this.recordedCommands = [];
    this.openingState = cloneState(this.state);
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
    this.emit([{ type: 'GameOver', winner }]);
  }

  /** `loser` resigns; opponent wins. */
  resign(loser: 'white' | 'black'): void {
    if (this.state.phase !== 'play') return;
    const winner = loser === 'white' ? 'black' : 'white';
    this.state = { ...this.state, phase: 'gameOver', winner };
    this.lastError = null;
    this.emit([{ type: 'GameOver', winner }]);
  }
}

function cloneState(state: MatchState): MatchState {
  return structuredClone(state);
}

export function pieceLabel(defId: string): string {
  try {
    return getPieceDefinition(defId).name;
  } catch {
    return defId;
  }
}
