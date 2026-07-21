import type { AbilityId, LegalMove } from '@chessforge/engine';

/**
 * Active abilities the player must arm with a toggle before targeting.
 * Without the toggle, the board shows only normal moves / captures.
 */
export const ARMABLE_ABILITIES: ReadonlySet<AbilityId> = new Set([
  'retreat',
  'royalWarp',
  'allyLeap',
  'allySwap',
  'blessHeal',
  'abdicate',
  'grantShield',
  'designatePromote',
  'curseEnemy',
  'spikeTile',
  'cloakPawn',
  'judgeBless',
  'heartEat',
  'throwSpear',
]);

/** Toggleable board actions: abilities + ram push. */
export type ArmedAction = AbilityId | 'push';

export const ABILITY_LABEL: Record<AbilityId, string> = {
  retreat: 'Отступление',
  royalWarp: 'Телепорт',
  allyLeap: 'Прыжок',
  allySwap: 'Обмен',
  blessHeal: 'Лечение',
  frontBless: 'Благословение (пассивно)',
  judgeBless: 'Приговор',
  abdicate: 'Передача титула',
  grantShield: 'Щит',
  designatePromote: 'Назначение пешки',
  curseEnemy: 'Проклятие',
  spikeTile: 'Шипы',
  cloakPawn: 'Покров',
  heartEat: 'Сердцеедка',
  throwSpear: 'Копьё',
  doubleMove: 'Двойной ход',
};

export function actionLabel(id: ArmedAction): string {
  if (id === 'push') return 'Таран';
  return ABILITY_LABEL[id] ?? id;
}

export function isArmableAbility(id: AbilityId | undefined): id is AbilityId {
  return Boolean(id && ARMABLE_ABILITIES.has(id));
}

/** Actions currently offered by this piece's legal move list. */
export function availableArmableActions(moves: LegalMove[]): ArmedAction[] {
  const seen = new Set<ArmedAction>();
  const out: ArmedAction[] = [];
  if (moves.some((m) => m.push)) {
    seen.add('push');
    out.push('push');
  }
  for (const m of moves) {
    if (!isArmableAbility(m.abilityId) || seen.has(m.abilityId)) continue;
    seen.add(m.abilityId);
    out.push(m.abilityId);
  }
  return out;
}

/**
 * When an action is armed — only its targets.
 * Otherwise — normal moves (castle / captures), no armable abilities / push.
 */
export function filterMovesForAbilityArm(
  moves: LegalMove[],
  armed: ArmedAction | null,
): LegalMove[] {
  if (armed === 'push') {
    return moves.filter((m) => Boolean(m.push));
  }
  if (armed) {
    return moves.filter((m) => m.abilityId === armed);
  }
  return moves.filter((m) => !isArmableAbility(m.abilityId) && !m.push);
}

/** One move per target square (ability moves already filtered). */
export function legalMapFromMoves(moves: LegalMove[]): Map<string, LegalMove> {
  const map = new Map<string, LegalMove>();
  for (const m of moves) {
    const key = `${m.to.x},${m.to.y}`;
    if (!map.has(key)) map.set(key, m);
  }
  return map;
}
