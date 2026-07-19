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

export type AppView = 'battle' | 'collection' | 'deck' | 'library';
export type BattleMode = 'ai' | 'online';

export type LastMoveHighlight = {
  from: Coord;
  to: Coord;
};

export type EndBanner = {
  kind: 'victory' | 'timeout';
  winner: PlayerId;
};

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
  clocks: MatchClocks;
  endBanner: EndBanner | null;
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
    const { moveHistory, clocks } = get();
    const realPlyCount = moveHistory.filter(isPlyEntry).length;
    const appended = formatEventsToHistory(events, state, realPlyCount + 1);
    const move = lastMoveFromEvents(events);

    let nextClocks = clocks;
    let endBanner = get().endBanner;
    for (const e of events) {
      if (e.type === 'TurnEnded') {
        nextClocks = switchClock(nextClocks, e.next);
      }
      if (e.type === 'GameOver') {
        nextClocks = {
          ...advanceClocks(nextClocks).clocks,
          active: null,
          lastTickAt: null,
        };
        endBanner = { kind: 'victory', winner: e.winner };
      }
    }

    set({
      state,
      events,
      lastError,
      clocks: nextClocks,
      endBanner,
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
          lastError: null,
          endBanner: null,
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
        lastError: null,
        endBanner: null,
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
    clocks: freshClocks(null),
    endBanner: null,
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
      const { battleMode } = get();
      if (battleMode === 'ai') {
        set({ endBanner: null, aiPlaying: false, selected: null });
        return;
      }
      set({ endBanner: null });
    },
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
      const legal = active.getLegalMovesFrom(selected).find(
        (m) => m.to.x === to.x && m.to.y === to.y,
      );
      active.submitCommand({
        type: 'move',
        from: selected,
        to,
        ...(legal?.abilityId !== undefined ? { abilityId: legal.abilityId } : {}),
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
        lastError: null,
        endBanner: null,
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
          lastError: null,
          endBanner: null,
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
        lastError: null,
        endBanner: null,
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
