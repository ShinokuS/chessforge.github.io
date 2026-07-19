import { create } from 'zustand';
import type { Coord, GameEvent, MatchState, PlayerId } from '@chessforge/engine';
import { GameSession } from '../adapters/GameSession';
import { OnlineGameSession } from '../adapters/OnlineGameSession';
import { LocalCollectionRepository } from '../repositories/LocalCollectionRepository';
import type { Deck } from '../repositories/types.js';
import {
  formatEventsToHistory,
  type MoveHistoryEntry,
} from '../battle/moveHistory';
import {
  advanceClocks,
  freshClocks,
  switchClock,
  type MatchClocks,
} from '../battle/clock';
import {
  clampAiStrength,
  timePresetMs,
  type AiStrengthLevel,
  type SidePreference,
  type TimePresetId,
} from '../battle/settings';
import {
  analyzeGame,
  type AnalyzedPly,
} from '../battle/analyzeGame';

export type AppView = 'battle' | 'collection' | 'deck' | 'library';
export type BattleMode = 'ai' | 'online';

export type LastMoveHighlight = {
  from: Coord;
  to: Coord;
};

export type EndBanner = {
  kind: 'victory' | 'timeout' | 'resign';
  winner: PlayerId;
  /** Who resigned (only for kind === 'resign'). */
  loser?: PlayerId;
};

export type GameAnalysis = {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: { done: number; total: number };
  plies: AnalyzedPly[];
  positions: MatchState[];
  /** 0 = стартовая позиция, n = после n-го полухода. */
  cursor: number;
  error: string | null;
};

const idleAnalysis = (): GameAnalysis => ({
  status: 'idle',
  progress: { done: 0, total: 0 },
  plies: [],
  positions: [],
  cursor: 0,
  error: null,
});

function lastMoveFromEvents(events: GameEvent[]): LastMoveHighlight | null {
  let from: Coord | null = null;
  let to: Coord | null = null;
  for (const e of events) {
    if (e.type === 'Moved') {
      from = e.from;
      to = e.to;
    } else if (e.type === 'Castled') {
      from = e.kingFrom;
      to = e.kingTo;
    } else if (e.type === 'Swapped') {
      from = e.from;
      to = e.to;
    } else if (e.type === 'Damaged' || e.type === 'Frozen') {
      from = e.from;
      to = e.at;
    } else if (e.type === 'Teleported') {
      if (from) to = e.to;
      else {
        from = e.from;
        to = e.to;
      }
    }
  }
  return from && to ? { from, to } : null;
}

type AppStore = {
  view: AppView;
  setView: (view: AppView) => void;
  battleMode: BattleMode;
  setBattleMode: (mode: BattleMode) => void;
  aiPlaying: boolean;
  aiStrength: AiStrengthLevel;
  setAiStrength: (v: AiStrengthLevel) => void;
  aiTimePreset: TimePresetId;
  setAiTimePreset: (v: TimePresetId) => void;
  onlineTimePreset: TimePresetId;
  setOnlineTimePreset: (v: TimePresetId) => void;
  onlineSide: SidePreference;
  setOnlineSide: (v: SidePreference) => void;
  session: GameSession;
  online: OnlineGameSession;
  state: MatchState;
  events: GameEvent[];
  moveHistory: MoveHistoryEntry[];
  lastMove: LastMoveHighlight | null;
  /** Piece defIds captured by each side (Lichess-style material). */
  captures: { white: string[]; black: string[] };
  clocks: MatchClocks;
  endBanner: EndBanner | null;
  analysis: GameAnalysis;
  lastError: string | null;
  selected: Coord | null;
  setSelected: (c: Coord | null) => void;
  repo: LocalCollectionRepository;
  activeDeckId: string;
  setActiveDeckId: (id: string) => void;
  refreshMeta: () => void;
  cards: ReturnType<LocalCollectionRepository['listCards']>;
  decks: Deck[];
  submitMove: (to: Coord) => void;
  startAiMatch: () => void;
  restart: () => void;
  saveDeck: (deck: Deck, opts?: { startBattle?: boolean; makeActive?: boolean }) => void;
  deleteDeck: (id: string) => void;
  canControl: (owner: PlayerId) => boolean;
  resetClocks: (active: PlayerId | null, initialMs?: number) => void;
  tickClock: () => void;
  dismissEndBanner: () => void;
  startGameAnalysis: () => Promise<void>;
  setAnalysisCursor: (cursor: number) => void;
  clearAnalysis: () => void;
  resign: () => void;
};

const repo = new LocalCollectionRepository();
const session = new GameSession('offline-ai');
const online = new OnlineGameSession();

const initialRoom =
  typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('room') ?? '')
    : '';

function isPlyEntry(e: MoveHistoryEntry): boolean {
  return e.kind === 'ply';
}

export const useAppStore = create<AppStore>((set, get) => {
  const appendEvents = (
    mode: BattleMode,
    state: MatchState,
    events: GameEvent[],
    lastError: string | null,
  ) => {
    if (get().battleMode !== mode) return;
    if (events.length === 0) {
      set({ state, events, lastError });
      return;
    }
    const { moveHistory, clocks, captures } = get();
    const realPlyCount = moveHistory.filter(isPlyEntry).length;
    const appended = formatEventsToHistory(events, state, realPlyCount + 1);
    const move = lastMoveFromEvents(events);

    let nextClocks = clocks;
    let endBanner = get().endBanner;
    const beforeState = get().state;
    const nextCaptures = {
      white: [...captures.white],
      black: [...captures.black],
    };
    for (const e of events) {
      if (e.type === 'Captured') {
        const victim = beforeState.pieces.find((p) => p.id === e.pieceId);
        if (victim) {
          const capturer = victim.owner === 'white' ? 'black' : 'white';
          nextCaptures[capturer].push(e.defId);
        }
      }
      if (e.type === 'TurnEnded') {
        nextClocks = switchClock(nextClocks, e.next);
      }
      if (e.type === 'GameOver') {
        nextClocks = {
          ...advanceClocks(nextClocks).clocks,
          active: null,
          lastTickAt: null,
        };
        const existing = get().endBanner;
        if (existing?.kind === 'resign' || existing?.kind === 'timeout') {
          endBanner = existing;
        } else if (events.length === 1) {
          endBanner = {
            kind: 'resign',
            winner: e.winner,
            loser: e.winner === 'white' ? 'black' : 'white',
          };
        } else {
          endBanner = { kind: 'victory', winner: e.winner };
        }
      }
    }

    set({
      state,
      events,
      lastError,
      clocks: nextClocks,
      endBanner,
      captures: nextCaptures,
      moveHistory: appended.length ? [...moveHistory, ...appended] : moveHistory,
      ...(move ? { lastMove: move } : {}),
    });
  };

  queueMicrotask(() => {
    session.subscribe(({ state, events, lastError }) => {
      appendEvents('ai', state, events, lastError);
    });
    online.subscribe(({ state, events, lastError }) => {
      appendEvents('online', state, events, lastError);
    });
  });

  return {
    view: 'battle',
    setView: (view) => set({ view }),
    battleMode: initialRoom ? 'online' : 'ai',
    aiPlaying: false,
    aiStrength: 6,
    setAiStrength: (aiStrength) => set({ aiStrength: clampAiStrength(aiStrength) }),
    aiTimePreset: '10',
    setAiTimePreset: (aiTimePreset) => set({ aiTimePreset }),
    onlineTimePreset: '10',
    setOnlineTimePreset: (onlineTimePreset) => set({ onlineTimePreset }),
    onlineSide: 'white',
    setOnlineSide: (onlineSide) => set({ onlineSide }),
    setBattleMode: (battleMode) => {
      const { online: o } = get();
      if (battleMode === 'ai') {
        o.disconnect();
        set({
          battleMode,
          aiPlaying: false,
          selected: null,
          moveHistory: [],
          lastMove: null,
          captures: { white: [], black: [] },
          lastError: null,
          endBanner: null,
          analysis: idleAnalysis(),
          clocks: freshClocks(null),
          state: session.getState(),
        });
        return;
      }
      set({
        battleMode,
        aiPlaying: false,
        selected: null,
        moveHistory: [],
        lastMove: null,
        captures: { white: [], black: [] },
        lastError: null,
        endBanner: null,
        analysis: idleAnalysis(),
        clocks: freshClocks(null),
        state: o.getState(),
      });
    },
    session,
    online,
    state: session.getState(),
    events: [],
    moveHistory: [],
    lastMove: null,
    captures: { white: [], black: [] },
    clocks: freshClocks(null),
    endBanner: null,
    analysis: idleAnalysis(),
    lastError: null,
    selected: null,
    setSelected: (selected) => set({ selected }),
    repo,
    activeDeckId: 'starter',
    setActiveDeckId: (activeDeckId) => set({ activeDeckId }),
    cards: repo.listCards(),
    decks: repo.listDecks(),
    refreshMeta: () =>
      set({
        cards: repo.listCards(),
        decks: repo.listDecks(),
      }),
    canControl: (owner) => {
      const { battleMode, online: o, endBanner, state, aiPlaying } = get();
      if (endBanner || state.phase === 'gameOver') return false;
      if (battleMode === 'ai') return aiPlaying && owner === 'white';
      return o.getMyColor() === owner;
    },
    resetClocks: (active, initialMs) => {
      const { battleMode, aiTimePreset, onlineTimePreset } = get();
      const ms =
        initialMs ??
        timePresetMs(battleMode === 'ai' ? aiTimePreset : onlineTimePreset);
      set({ clocks: freshClocks(active, ms), endBanner: null });
    },
    tickClock: () => {
      const { clocks, endBanner, state, battleMode, online: o, session: s, aiPlaying } =
        get();
      if (endBanner || state.phase === 'gameOver') return;
      const shouldRun =
        battleMode === 'ai'
          ? aiPlaying && state.phase === 'play'
          : o.getStatus() === 'playing' && state.phase === 'play';
      if (!shouldRun || !clocks.active) return;
      const { clocks: next, timeoutWinner } = advanceClocks(clocks);
      if (timeoutWinner) {
        set({
          clocks: next,
          endBanner: { kind: 'timeout', winner: timeoutWinner },
          selected: null,
        });
        if (battleMode === 'ai') s.endByTimeout(timeoutWinner);
        else o.endByTimeout(timeoutWinner);
        return;
      }
      set({ clocks: next });
    },
    dismissEndBanner: () => {
      const { battleMode, analysis } = get();
      if (battleMode === 'ai') {
        // Keep board if analysis is open / running.
        const keepBoard = analysis.status === 'running' || analysis.status === 'done';
        set({
          endBanner: null,
          aiPlaying: keepBoard,
          selected: null,
        });
        return;
      }
      set({ endBanner: null });
    },
    resign: () => {
      const { battleMode, session: s, online: o, endBanner, state, aiPlaying } = get();
      if (endBanner || state.phase === 'gameOver') return;

      if (battleMode === 'ai') {
        if (!aiPlaying || state.phase !== 'play') return;
        set({
          endBanner: { kind: 'resign', winner: 'black', loser: 'white' },
          selected: null,
        });
        s.resign('white');
        return;
      }

      if (o.getStatus() !== 'playing' || state.phase !== 'play') return;
      const myColor = o.getMyColor();
      if (!myColor) return;
      set({
        endBanner: {
          kind: 'resign',
          winner: myColor === 'white' ? 'black' : 'white',
          loser: myColor,
        },
        selected: null,
      });
      o.resign();
    },
    startGameAnalysis: async () => {
      const { session: s, battleMode } = get();
      if (battleMode !== 'ai') return;
      const replay = s.getReplay();
      if (!replay || replay.commands.length === 0) {
        set({
          analysis: {
            ...idleAnalysis(),
            status: 'error',
            error: 'Нет ходов для анализа',
          },
          endBanner: null,
          aiPlaying: true,
        });
        return;
      }
      set({
        endBanner: null,
        aiPlaying: true,
        selected: null,
        analysis: {
          status: 'running',
          progress: { done: 0, total: replay.commands.length },
          plies: [],
          positions: [structuredClone(replay.opening)],
          cursor: 0,
          error: null,
        },
      });
      try {
        const { plies, positions } = await analyzeGame(
          replay.opening,
          replay.commands,
          undefined,
          (p) => {
            set({
              analysis: {
                ...get().analysis,
                status: 'running',
                progress: p,
              },
            });
          },
        );
        set({
          analysis: {
            status: 'done',
            progress: { done: plies.length, total: plies.length },
            plies,
            positions,
            cursor: Math.max(0, positions.length - 1),
            error: null,
          },
        });
      } catch (err) {
        set({
          analysis: {
            ...idleAnalysis(),
            status: 'error',
            error: err instanceof Error ? err.message : 'Ошибка анализа',
          },
        });
      }
    },
    setAnalysisCursor: (cursor) => {
      const { analysis } = get();
      if (analysis.status !== 'done' || analysis.positions.length === 0) return;
      const c = Math.max(0, Math.min(analysis.positions.length - 1, Math.floor(cursor)));
      set({ analysis: { ...analysis, cursor: c }, selected: null });
    },
    clearAnalysis: () => set({ analysis: idleAnalysis() }),
    submitMove: (to) => {
      const { selected, battleMode, session: s, online: o, canControl, state, endBanner, aiPlaying } =
        get();
      if (endBanner || state.phase === 'gameOver') return;
      if (battleMode === 'ai' && !aiPlaying) return;
      if (!selected) return;
      const piece = state.pieces.find(
        (p) => p.pos.x === selected.x && p.pos.y === selected.y,
      );
      if (!piece || !canControl(piece.owner)) return;

      const active = battleMode === 'online' ? o : s;
      const moves = active
        .getLegalMovesFrom(selected)
        .filter((m) => m.to.x === to.x && m.to.y === to.y);
      const legal =
        moves.find((m) => Boolean(m.abilityId) || Boolean(m.push)) ?? moves[0];
      if (!legal) return;
      active.submitCommand({
        type: 'move',
        from: selected,
        to,
        ...(legal.abilityId !== undefined ? { abilityId: legal.abilityId } : {}),
      });
      set({ selected: null });
    },
    startAiMatch: () => {
      const { repo: r, activeDeckId, session: s, aiStrength, aiTimePreset } = get();
      const deck = r.getDeck(activeDeckId);
      if (!deck || deck.placements.length < 16) {
        set({ lastError: 'Выберите полную сохранённую колоду' });
        return;
      }
      s.setAiStrength(aiStrength);
      s.restart(deck);
      const ms = timePresetMs(aiTimePreset);
      set({
        aiPlaying: true,
        selected: null,
        moveHistory: [],
        lastMove: null,
        captures: { white: [], black: [] },
        lastError: null,
        endBanner: null,
        analysis: idleAnalysis(),
        clocks: freshClocks('white', ms),
        state: s.getState(),
        view: 'battle',
        battleMode: 'ai',
      });
    },
    restart: () => {
      const { battleMode, online: o } = get();
      if (battleMode === 'online') {
        o.disconnect();
        set({
          selected: null,
          moveHistory: [],
          lastMove: null,
          captures: { white: [], black: [] },
          lastError: null,
          endBanner: null,
          analysis: idleAnalysis(),
          clocks: freshClocks(null),
          state: o.getState(),
        });
        return;
      }
      set({
        aiPlaying: false,
        selected: null,
        moveHistory: [],
        lastMove: null,
        captures: { white: [], black: [] },
        lastError: null,
        endBanner: null,
        analysis: idleAnalysis(),
        clocks: freshClocks(null),
        state: session.getState(),
      });
    },
    saveDeck: (deck, opts) => {
      repo.saveDeck(deck);
      const startBattle = opts?.startBattle ?? false;
      const makeActive = opts?.makeActive ?? true;
      const patch: Partial<AppStore> = {
        decks: repo.listDecks(),
        selected: null,
      };
      if (makeActive) patch.activeDeckId = deck.id;
      if (startBattle) {
        patch.view = 'battle';
        patch.battleMode = 'ai';
        patch.aiPlaying = false;
        patch.endBanner = null;
        patch.clocks = freshClocks(null);
      }
      set(patch);
    },
    deleteDeck: (id) => {
      if (id === 'starter') return;
      repo.deleteDeck(id);
      const decks = repo.listDecks();
      const { activeDeckId } = get();
      set({
        decks,
        activeDeckId: activeDeckId === id ? (decks[0]?.id ?? 'starter') : activeDeckId,
      });
    },
  };
});
