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
import { estimateModStrength, isPremiumMod } from './heuristics.js';

const SCORE_NOISE = 22;

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

type Candidate = {
  slotId: FormationSlotId;
  defId: string;
  cost: number;
  strength: number;
  premium: boolean;
  score: number;
};

function pickTargetSpend(rng: () => number): number {
  const roll = rng();
  if (roll < 0.5) return DECK_COST_CAP;
  if (roll < 0.78) return DECK_COST_CAP - 1;
  if (roll < 0.92) return DECK_COST_CAP - 2;
  return 6 + Math.floor(rng() * 2);
}

/**
 * Random classic formation biased toward feature-strong mods and high spend.
 * Strength comes from def flags (freeze, HP, abilities…), not id tables.
 */
export function buildAiDeck(seed = 1): FormationPlacement[] {
  const rng = mulberry32(seed >>> 0);
  const map = new Map<FormationSlotId, string>(
    classicBasePlacements().map((p) => [p.slotId, p.defId]),
  );

  const targetSpend = pickTargetSpend(rng);

  const candidates: Candidate[] = [];
  for (const slot of FORMATION_SLOTS) {
    for (const mod of listPieceDefinitionsByRole(slot.role).filter((d) => !d.isBase)) {
      const strength = estimateModStrength(mod);
      candidates.push({
        slotId: slot.id,
        defId: mod.id,
        cost: mod.cost,
        strength,
        premium: isPremiumMod(mod),
        score: strength + rng() * SCORE_NOISE,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  let spent = 0;
  const usedSlots = new Set<FormationSlotId>();

  const place = (c: Candidate): boolean => {
    if (usedSlots.has(c.slotId)) return false;
    const next = spent + c.cost;
    if (next > DECK_COST_CAP) return false;
    map.set(c.slotId, c.defId);
    usedSlots.add(c.slotId);
    spent = next;
    return true;
  };

  if (rng() < 0.4) {
    const engines = candidates
      .filter((c) => c.cost < 0)
      .sort((a, b) => a.cost - b.cost || b.score - a.score);
    for (const eng of engines) {
      if (place(eng)) break;
    }
  }

  for (const c of candidates) {
    if (c.cost <= 0) continue;
    if (usedSlots.has(c.slotId)) continue;
    if (spent + c.cost > DECK_COST_CAP) continue;
    if (spent + c.cost > targetSpend && !c.premium) continue;
    if (rng() < 0.06 && !c.premium) continue;
    place(c);
  }

  const fillers = candidates
    .filter((c) => c.cost > 0 && !usedSlots.has(c.slotId))
    .sort((a, b) => b.strength - a.strength || b.score - a.score);
  for (const c of fillers) {
    if (spent >= targetSpend && spent >= DECK_COST_CAP - 1) break;
    if (spent + c.cost > DECK_COST_CAP) continue;
    if (spent + c.cost > targetSpend && spent >= targetSpend) continue;
    place(c);
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
