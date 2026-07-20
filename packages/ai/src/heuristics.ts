import type { MovementPattern, PieceDefinition, PieceRole } from '@chessforge/engine';

/** Centipawn-ish role baselines (pawn ≈ 100). */
export const ROLE_VALUE: Record<PieceRole, number> = {
  king: 100_000,
  queen: 900,
  rook: 500,
  bishop: 320,
  knight: 300,
  pawn: 100,
};

function movementRichness(patterns: ReadonlyArray<MovementPattern>, depth = 0): number {
  if (depth > 3) return 0;
  let n = 0;
  for (const p of patterns) {
    if (p.kind === 'leap') n += Math.min(12, p.offsets.length);
    else if (p.kind === 'slide') n += Math.min(8, p.directions.length) * Math.min(4, p.maxRange);
    else if (p.kind === 'conditional') n += movementRichness(p.patterns, depth + 1) * 0.6;
  }
  return n;
}

/**
 * Extra material for a piece from its definition features (not id tables).
 * Works for any future mod as long as engine flags/fields describe it.
 */
export function featureModBonus(def: PieceDefinition): number {
  if (def.isBase) return 0;

  let b = def.cost * 22;

  if (def.maxHp > 1) b += (def.maxHp - 1) * 55;
  if (def.attack <= 0 && !def.freezeInsteadOfCapture && !def.lineBuff) b -= 25;

  if (def.freezeInsteadOfCapture) {
    b += 85 + (def.freezeRange ?? 3) * 18;
  }
  if (def.lineBuff) {
    b += 70 + Math.min(40, def.lineBuff.maxRange * 6);
  }
  if (def.abilities?.length) {
    b += def.abilities.length * 58;
  }
  if (def.immobile) b -= 90;
  if (def.cannotCapture && !def.freezeInsteadOfCapture && !def.lineBuff) b -= 35;
  if (def.splitCapture && def.captureOffsets) {
    b += Math.min(40, def.captureOffsets.length * 12);
  }

  if (def.marshAuraRadius) b += 55 + def.marshAuraRadius * 20;
  if (def.royalEscort) b += 35;
  if (def.doubleMoveOnce) b += 75;
  if (def.spikePlacer) b += 45;
  if (def.postMoveFreezeTurns) b -= def.postMoveFreezeTurns * 12;
  if (def.skipFirstTurn) b -= 40;

  const rich = movementRichness(def.movement);
  // Relative to a typical base of the same role (~8–16).
  b += Math.max(-40, Math.min(70, (rich - 10) * 4));

  // Keep mods in a sane band so search isn't drowned by static inflation.
  // Cap was 200 — that made fancy decks look “winning” while getting mated.
  return Math.round(Math.max(-80, Math.min(110, b)));
}

/** Unused once-per-match ability value (id-agnostic). */
export function unusedAbilityValue(): number {
  return 40;
}

/**
 * 0–100 deck-building strength derived from the same features as eval.
 * Negative-cost / immobile pieces score low as combat units (budget engines).
 */
export function estimateModStrength(def: PieceDefinition): number {
  if (def.isBase) return 0;
  if (def.immobile || def.cost < 0) {
    return Math.max(8, 20 + def.cost * 2);
  }

  let s = 40 + def.cost * 8;
  s += featureModBonus(def) * 0.22;
  if (def.freezeInsteadOfCapture) s += 18;
  if (def.lineBuff) s += 12;
  if (def.abilities?.length) s += def.abilities.length * 8;
  if (def.maxHp > 1) s += (def.maxHp - 1) * 10;
  if (def.cannotCapture && !def.freezeInsteadOfCapture && !def.lineBuff) s -= 15;

  return Math.max(15, Math.min(99, Math.round(s)));
}

/** True if this mod is a “premium” threat worth stretching soft budget. */
export function isPremiumMod(def: PieceDefinition): boolean {
  return (
    def.freezeInsteadOfCapture === true ||
    def.lineBuff !== undefined ||
    (def.abilities?.length ?? 0) > 0 ||
    def.maxHp > 1 ||
    def.cost >= 3
  );
}
