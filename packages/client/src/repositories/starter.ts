import { classicBasePlacements } from '@chessforge/engine';
import type { Deck, OwnedCard } from './types.js';

export const STARTER_COLLECTION: OwnedCard[] = [
  { defId: 'king', count: 1 },
  { defId: 'warden', count: 1 },
  { defId: 'anchor', count: 1 },
  { defId: 'queen', count: 1 },
  { defId: 'regent', count: 1 },
  { defId: 'cryomancer', count: 1 },
  { defId: 'rook', count: 2 },
  { defId: 'sprinter', count: 1 },
  { defId: 'sentry', count: 1 },
  { defId: 'bishop', count: 2 },
  { defId: 'chaplain', count: 1 },
  { defId: 'exchanger', count: 1 },
  { defId: 'knight', count: 2 },
  { defId: 'lancer', count: 1 },
  { defId: 'outrider', count: 1 },
  { defId: 'pawn', count: 8 },
  { defId: 'skirmisher', count: 2 },
  { defId: 'ironclad', count: 2 },
  { defId: 'spearman', count: 2 },
];

export const STARTER_DECK: Deck = {
  id: 'starter',
  name: 'Классический строй',
  placements: classicBasePlacements(),
};
