import type { CollectionRepository, Deck, OwnedCard } from './types.js';
import { STARTER_COLLECTION, STARTER_DECK } from './starter.js';

const STORAGE_KEY = 'chessforge.collection.v3';

type StoredPayload = {
  version: 3;
  cards: OwnedCard[];
  decks: Deck[];
};

function initialPayload(): StoredPayload {
  return {
    version: 3,
    cards: STARTER_COLLECTION,
    decks: [STARTER_DECK],
  };
}

function read(): StoredPayload {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.removeItem('chessforge.collection.v1');
    localStorage.removeItem('chessforge.collection.v2');
    const initial = initialPayload();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
  const parsed = JSON.parse(raw) as StoredPayload;
  if (parsed.version !== 3 || !Array.isArray(parsed.decks?.[0]?.placements)) {
    const initial = initialPayload();
    write(initial);
    return initial;
  }
  return parsed;
}

function write(payload: StoredPayload): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export class LocalCollectionRepository implements CollectionRepository {
  listCards(): OwnedCard[] {
    return read().cards;
  }

  listDecks(): Deck[] {
    return read().decks;
  }

  getDeck(id: string): Deck | null {
    return read().decks.find((d) => d.id === id) ?? null;
  }

  saveDeck(deck: Deck): void {
    const data = read();
    const idx = data.decks.findIndex((d) => d.id === deck.id);
    if (idx >= 0) {
      data.decks[idx] = deck;
    } else {
      data.decks.push(deck);
    }
    write(data);
  }

  resetToStarter(): void {
    write(initialPayload());
  }
}
