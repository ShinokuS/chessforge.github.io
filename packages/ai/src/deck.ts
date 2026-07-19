import {
  DECK_COST_CAP,
  FORMATION_SLOTS,
  classicBasePlacements,
  deckCost,
  getFormationSlot,
  getPieceDefinition,
  listPieceDefinitionsByRole,
  type FormationPlacement,
  type FormationSlotId,
} from '@chessforge/engine';

/** Soft preference weights — noise in buildAiDeck dominates variety. */
const MOD_PRIORITY: Record<string, number> = {
  chaplain: 100,
  outrider: 95,
  regent: 90,
  ironclad: 85,
  warden: 80,
  sprinter: 75,
  skirmisher: 70,
  exchanger: 68,
  spearman: 65,
  lancer: 60,
  cryomancer: 58,
  sentry: 56,
  anchor: 55,
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a full classic formation, spending up to a random budget ≤ DECK_COST_CAP.
 * Same seed → same deck; different seeds diverge strongly.
 */
export function buildAiDeck(seed = 1): FormationPlacement[] {
  const rng = mulberry32(seed >>> 0);
  const map = new Map<FormationSlotId, string>(
    classicBasePlacements().map((p) => [p.slotId, p.defId]),
  );

  // Spend somewhere from ~40% to 100% of the cap so decks are not always maxed.
  // Anchor (-3) can push effective spend above raw cost sum; clamp budget checks by DECK_COST_CAP on final.
  const budgetFloor = Math.max(2, Math.floor(DECK_COST_CAP * 0.4));
  const budget = budgetFloor + Math.floor(rng() * (DECK_COST_CAP - budgetFloor + 1));

  type Candidate = { slotId: FormationSlotId; defId: string; cost: number; score: number };
  const candidates: Candidate[] = [];

  for (const slot of FORMATION_SLOTS) {
    const mods = listPieceDefinitionsByRole(slot.role).filter((d) => !d.isBase);
    for (const mod of mods) {
      const bias = (MOD_PRIORITY[mod.id] ?? 10) / Math.max(1, Math.abs(mod.cost) || 1);
      candidates.push({
        slotId: slot.id,
        defId: mod.id,
        cost: mod.cost,
        score: bias * 0.15 + rng() * 100,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  let spent = 0;
  const usedSlots = new Set<FormationSlotId>();

  const tryPlace = (c: Candidate, allowSkip: boolean): boolean => {
    if (usedSlots.has(c.slotId)) return false;
    const next = spent + c.cost;
    if (next > DECK_COST_CAP) return false;
    if (c.cost > 0 && next > budget && spent >= budgetFloor) return false;
    if (allowSkip && rng() < 0.22) return false;
    map.set(c.slotId, c.defId);
    usedSlots.add(c.slotId);
    spent = next;
    return true;
  };

  for (const c of candidates) {
    tryPlace(c, true);
    if (spent >= budget && spent >= budgetFloor) break;
  }

  if (spent < budget) {
    for (const c of candidates) {
      tryPlace(c, false);
      if (spent >= budget) break;
    }
  }

  const placements: FormationPlacement[] = [...map.entries()].map(([slotId, defId]) => ({
    slotId,
    defId,
  }));

  for (const p of placements) {
    const slot = getFormationSlot(p.slotId);
    const def = getPieceDefinition(p.defId);
    if (def.baseRole !== slot.role) {
      throw new Error(`AI deck invalid: ${p.defId} in ${p.slotId}`);
    }
  }

  if (deckCost(placements) > DECK_COST_CAP) {
    throw new Error('AI deck over budget');
  }
  if (placements.length !== FORMATION_SLOTS.length) {
    throw new Error('AI deck incomplete');
  }

  return placements;
}
