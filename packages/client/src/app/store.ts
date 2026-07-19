import { create } from 'zustand';
import type { Coord, GameEvent, MatchState } from '@chessforge/engine';
import { GameSession } from '../adapters/GameSession';
import { LocalCollectionRepository } from '../repositories/LocalCollectionRepository';
import type { Deck } from '../repositories/types.js';

export type AppView = 'battle' | 'collection' | 'deck' | 'library';

type AppStore = {
  view: AppView;
  setView: (view: AppView) => void;
  session: GameSession;
  state: MatchState;
  events: GameEvent[];
  lastError: string | null;
  selected: Coord | null;
  setSelected: (c: Coord | null) => void;
  repo: LocalCollectionRepository;
  activeDeckId: string;
  refreshMeta: () => void;
  cards: ReturnType<LocalCollectionRepository['listCards']>;
  decks: Deck[];
  submitMove: (to: Coord) => void;
  restart: () => void;
  saveDeck: (deck: Deck) => void;
};

const repo = new LocalCollectionRepository();
const session = new GameSession('offline-ai');

export const useAppStore = create<AppStore>((set, get) => {
  session.subscribe(({ state, events, lastError }) => {
    set({ state, events, lastError });
  });

  return {
    view: 'battle',
    setView: (view) => set({ view }),
    session,
    state: session.getState(),
    events: [],
    lastError: null,
    selected: null,
    setSelected: (selected) => set({ selected }),
    repo,
    activeDeckId: 'starter',
    cards: repo.listCards(),
    decks: repo.listDecks(),
    refreshMeta: () =>
      set({
        cards: repo.listCards(),
        decks: repo.listDecks(),
      }),
    submitMove: (to) => {
      const { selected, session: s } = get();
      if (!selected) return;
      const legal = s.getLegalMovesFrom(selected).find(
        (m) => m.to.x === to.x && m.to.y === to.y,
      );
      s.submitCommand({
        type: 'move',
        from: selected,
        to,
        ...(legal?.abilityId !== undefined ? { abilityId: legal.abilityId } : {}),
      });
      set({ selected: null });
    },
    restart: () => {
      const { repo: r, activeDeckId, session: s } = get();
      const deck = r.getDeck(activeDeckId) ?? undefined;
      s.restart(deck ?? undefined);
      set({ selected: null });
    },
    saveDeck: (deck) => {
      repo.saveDeck(deck);
      const { session: s } = get();
      s.restart(deck);
      set({
        decks: repo.listDecks(),
        activeDeckId: deck.id,
        selected: null,
      });
    },
  };
});
