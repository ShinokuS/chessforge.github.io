import type { Coord } from '../board/types.js';
import { inBounds } from '../board/types.js';
import type { BoardSpec, PieceInstance } from '../match/types.js';
import { getPieceDefinition } from '../defs/catalog.js';

export type AuraKind = 'marsh' | 'freeze' | 'heal';

export type PieceAuraOverlay = {
  kind: AuraKind;
  radius: number;
  /** All squares within Chebyshev radius, including the piece's own cell. */
  cells: Coord[];
};

function chebyshev(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Passive / ability reach zones shown on hover (Топь, Чародейка, Кардинал…).
 */
export function getPieceAuraOverlay(
  piece: PieceInstance,
  board: BoardSpec,
): PieceAuraOverlay | null {
  const def = getPieceDefinition(piece.defId);
  let kind: AuraKind | null = null;
  let radius = 0;

  if (def.marshAuraRadius && def.marshAuraRadius > 0) {
    kind = 'marsh';
    radius = def.marshAuraRadius;
  } else if (def.freezeInsteadOfCapture) {
    kind = 'freeze';
    radius = def.freezeRange ?? 3;
  } else if (def.abilities?.some((a) => a.id === 'blessHeal')) {
    kind = 'heal';
    radius = 3;
  }

  if (!kind || radius <= 0) return null;

  const cells: Coord[] = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const at = { x, y };
      if (!inBounds(at, board.width, board.height)) continue;
      if (chebyshev(piece.pos, at) <= radius) cells.push(at);
    }
  }
  return { kind, radius, cells };
}
