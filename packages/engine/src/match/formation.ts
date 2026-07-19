import type { Coord, PlayerId } from '../board/types.js';
import type { PieceRole } from '../match/types.js';

export type FormationSlotId =
  | 'a1'
  | 'b1'
  | 'c1'
  | 'd1'
  | 'e1'
  | 'f1'
  | 'g1'
  | 'h1'
  | 'a2'
  | 'b2'
  | 'c2'
  | 'd2'
  | 'e2'
  | 'f2'
  | 'g2'
  | 'h2';

export type FormationSlot = {
  id: FormationSlotId;
  /** 0 = a … 7 = h */
  file: number;
  /** 0 = back rank, 1 = pawn rank (from that side's perspective). */
  homeRank: 0 | 1;
  role: PieceRole;
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

const BACK_ROLES: PieceRole[] = [
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
  'bishop',
  'knight',
  'rook',
];

/** Classic white home slots (a1–h1, a2–h2). Black mirrors by rank. */
export const FORMATION_SLOTS: FormationSlot[] = [
  ...BACK_ROLES.map((role, file) => ({
    id: `${FILES[file]}1` as FormationSlotId,
    file,
    homeRank: 0 as const,
    role,
  })),
  ...FILES.map((fileLetter, file) => ({
    id: `${fileLetter}2` as FormationSlotId,
    file,
    homeRank: 1 as const,
    role: 'pawn' as const,
  })),
];

export function getFormationSlot(id: FormationSlotId): FormationSlot {
  const slot = FORMATION_SLOTS.find((s) => s.id === id);
  if (!slot) throw new Error(`Unknown formation slot: ${id}`);
  return slot;
}

/** Map a home slot to absolute board coordinates for a side. */
export function slotToCoord(slot: FormationSlot, owner: PlayerId): Coord {
  if (owner === 'white') {
    return { x: slot.file, y: slot.homeRank };
  }
  return { x: slot.file, y: 7 - slot.homeRank };
}

export type FormationPlacement = {
  slotId: FormationSlotId;
  defId: string;
};

/** Default classic army: each slot filled with its base role piece. */
export function classicBasePlacements(): FormationPlacement[] {
  return FORMATION_SLOTS.map((slot) => ({
    slotId: slot.id,
    defId: slot.role,
  }));
}
