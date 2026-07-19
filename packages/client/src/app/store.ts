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

export type AppView = 'battle' | 'collection' | 'deck' | 'library';
export type BattleMode = 'ai' | 'online';

type AppStore = {
  view: AppView;
  setView: (view: AppView) => void;
  battleMode: BattleMode;
  setBattleMode: (mode: BattleMode) => void;
  session: GameSession;
  online: OnlineGameSession;
  state: MatchState;
  events: GameEvent[];
  moveHistory: MoveHistoryEntry[];
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
  restart: () => void;
  saveDeck: (deck: Deck, opts?: { startBattle?: boolean; makeActive?: boolean }) => void;
  deleteDeck: (id: string) => void;
  canControl: (owner: PlayerId) => boolean;
};

const repo = new LocalCollectionRepository();
const session = new GameSession('offline-ai');
const online = new OnlineGameSession();

const initialRoom =
  typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('room') ?? '')
    : '';

function isPlyEntry(e: MoveHistoryEntry): boolean {
  return (
    e.text.startsWith('Рокировка') ||
    e.text.includes('→') ||
    (e.text.includes('удар') && !e.text.startsWith('Шипы'))
  );
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
    const { moveHistory } = get();
    const realPlyCount = moveHistory.filter(isPlyEntry).length;
    const appended = formatEventsToHistory(events, state, realPlyCount + 1);
    set({
      state,
      events,
      lastError,
      moveHistory: appended.length ? [...moveHistory, ...appended] : moveHistory,
    });
  };

  // Subscribe after store exists (avoid get() during initializer)
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
    setBattleMode: (battleMode) => {
      const { repo: r, activeDeckId, session: s, online: o } = get();
      if (battleMode === 'ai') {
        o.disconnect();
        const deck = r.getDeck(activeDeckId) ?? undefined;
        s.restart(deck ?? undefined);
        set({
          battleMode,
          selected: null,
          moveHistory: [],
          lastError: null,
          state: s.getState(),
        });
        return;
      }
      set({
        battleMode,
        selected: null,
        moveHistory: [],
        lastError: null,
        state: o.getState(),
      });
    },
    session,
    online,
    state: session.getState(),
    events: [],
    moveHistory: [],
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
      const { battleMode, online: o } = get();
      if (battleMode === 'ai') return owner === 'white';
      return o.getMyColor() === owner;
    },
    submitMove: (to) => {
      const { selected, battleMode, session: s, online: o, canControl, state } = get();
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
    restart: () => {
      const { repo: r, activeDeckId, session: s, battleMode, online: o } = get();
      if (battleMode === 'online') {
        o.disconnect();
        set({ selected: null, moveHistory: [], lastError: null, state: o.getState() });
        return;
      }
      const deck = r.getDeck(activeDeckId) ?? undefined;
      s.restart(deck ?? undefined);
      set({ selected: null, moveHistory: [], state: s.getState() });
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
        const { session: s, battleMode } = get();
        if (battleMode === 'ai') {
          s.restart(deck);
          patch.moveHistory = [];
          patch.state = s.getState();
        }
        patch.view = 'battle';
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
