import type { FormationPlacement, FormationSlotId } from '@chessforge/engine';

/** Interface ready to swap for ApiCollectionRepository later. */
export type OwnedCard = {
  defId: string;
  count: number;
};

/** @deprecated legacy count bags — kept only for migration typing */
export type DeckEntry = {
  defId: string;
  count: number;
};

export type Deck = {
  id: string;
  name: string;
  /** Classic formation: each filled slot maps to a piece def from the collection. */
  placements: FormationPlacement[];
};

export interface CollectionRepository {
  listCards(): OwnedCard[];
  listDecks(): Deck[];
  getDeck(id: string): Deck | null;
  saveDeck(deck: Deck): void;
  resetToStarter(): void;
}

export type { FormationPlacement, FormationSlotId };
