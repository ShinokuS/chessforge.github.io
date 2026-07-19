import { useMemo, useState } from 'react';
import styles from './DeckBuilderView.module.css';
import {
  DECK_COST_CAP,
  FORMATION_SLOTS,
  ROLE_LABELS,
  deckCost,
  getPieceDefinition,
  listPieceDefinitionsByRole,
  type FormationPlacement,
  type FormationSlot,
  type FormationSlotId,
} from '@chessforge/engine';
import { useAppStore } from '../app/store';
import type { Deck } from '../repositories/types';
import { PieceIcon } from '../battle/PieceIcon';

function placementsToMap(
  placements: FormationPlacement[],
): Map<FormationSlotId, string> {
  return new Map(placements.map((p) => [p.slotId, p.defId]));
}

function countUsed(map: Map<FormationSlotId, string>): Map<string, number> {
  const used = new Map<string, number>();
  for (const defId of map.values()) {
    used.set(defId, (used.get(defId) ?? 0) + 1);
  }
  return used;
}

export function DeckBuilderView() {
  const cards = useAppStore((s) => s.cards);
  const decks = useAppStore((s) => s.decks);
  const saveDeck = useAppStore((s) => s.saveDeck);
  const setView = useAppStore((s) => s.setView);
  const starter = decks.find((d) => d.id === 'starter') ?? decks[0];

  const [name, setName] = useState(starter?.name ?? 'Моя колода');
  const [slotMap, setSlotMap] = useState(() =>
    placementsToMap(starter?.placements ?? []),
  );
  const [selectedSlot, setSelectedSlot] = useState<FormationSlot | null>(null);
  const [selectedPoolDef, setSelectedPoolDef] = useState<string | null>(null);

  const owned = useMemo(() => new Map(cards.map((c) => [c.defId, c.count])), [cards]);
  const used = useMemo(() => countUsed(slotMap), [slotMap]);
  const filled = slotMap.size;
  const totalSlots = FORMATION_SLOTS.length;
  const placementsNow: FormationPlacement[] = [...slotMap.entries()].map(
    ([slotId, defId]) => ({ slotId, defId }),
  );
  const cost = deckCost(placementsNow);
  const overBudget = cost > DECK_COST_CAP;

  const remainingFor = (defId: string) =>
    (owned.get(defId) ?? 0) - (used.get(defId) ?? 0);

  const poolForSelected = selectedSlot
    ? listPieceDefinitionsByRole(selectedSlot.role)
    : [];

  const placeOnSlot = (slot: FormationSlot, defId: string) => {
    const def = getPieceDefinition(defId);
    if (def.baseRole !== slot.role) return;

    setSlotMap((prev) => {
      const next = new Map(prev);
      const previous = next.get(slot.id);
      // temporary remove to recalc remaining
      if (previous) next.delete(slot.id);
      const currentlyUsed = countUsed(next).get(defId) ?? 0;
      const maxOwned = owned.get(defId) ?? 0;
      if (currentlyUsed >= maxOwned) {
        if (previous) next.set(slot.id, previous);
        return prev;
      }
      next.set(slot.id, defId);
      return next;
    });
    setSelectedPoolDef(null);
  };

  const clearSlot = (slotId: FormationSlotId) => {
    setSlotMap((prev) => {
      const next = new Map(prev);
      next.delete(slotId);
      return next;
    });
  };

  const onSlotClick = (slot: FormationSlot) => {
    if (selectedPoolDef) {
      placeOnSlot(slot, selectedPoolDef);
      setSelectedSlot(slot);
      return;
    }
    setSelectedSlot(slot);
  };

  const onSave = () => {
    const placements: FormationPlacement[] = [...slotMap.entries()].map(
      ([slotId, defId]) => ({ slotId, defId }),
    );
    const deck: Deck = {
      id: starter?.id ?? 'starter',
      name,
      placements,
    };
    saveDeck(deck);
    setView('battle');
  };

  const backRank = FORMATION_SLOTS.filter((s) => s.homeRank === 0);
  const pawnRank = FORMATION_SLOTS.filter((s) => s.homeRank === 1);

  return (
    <section className={styles.wrap}>
      <div className={styles.head}>
        <h2>Сбор колоды</h2>
        <p>
          Классическая расстановка: полный комплект из {totalSlots} фигур. Лимит стоимости колоды:{' '}
          {DECK_COST_CAP}. Модификации занимают слот своей базовой роли.
        </p>
        <label className={styles.name}>
          Название
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className={styles.count}>
          Слоты: {filled}/{totalSlots} · стоимость: {cost}/{DECK_COST_CAP}
          {overBudget ? ' — превышен лимит' : ''}
        </p>
      </div>

      <div className={styles.layout}>
        <div className={styles.boardBlock}>
          <div className={styles.board} role="grid" aria-label="Доска расстановки">
            <div className={styles.rank}>
              {pawnRank.map((slot) => {
                const defId = slotMap.get(slot.id);
                const active = selectedSlot?.id === slot.id;
                const isDark = slot.file % 2 === 0;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    className={[
                      styles.cell,
                      isDark ? styles.dark : styles.light,
                      active ? styles.cellActive : '',
                      !defId ? styles.cellEmpty : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onSlotClick(slot)}
                    title={`${slot.id} · ${ROLE_LABELS[slot.role]}`}
                  >
                    {defId ? (
                      <PieceIcon defId={defId} owner="white" className={styles.piece} />
                    ) : (
                      <span className={styles.slotHint}>{ROLE_LABELS[slot.role][0]}</span>
                    )}
                    <span className={styles.coord}>{slot.id}</span>
                  </button>
                );
              })}
            </div>
            <div className={styles.rank}>
              {backRank.map((slot) => {
                const defId = slotMap.get(slot.id);
                const active = selectedSlot?.id === slot.id;
                const isDark = slot.file % 2 === 1;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    className={[
                      styles.cell,
                      isDark ? styles.dark : styles.light,
                      active ? styles.cellActive : '',
                      !defId ? styles.cellEmpty : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onSlotClick(slot)}
                    title={`${slot.id} · ${ROLE_LABELS[slot.role]}`}
                  >
                    {defId ? (
                      <PieceIcon defId={defId} owner="white" className={styles.piece} />
                    ) : (
                      <span className={styles.slotHint}>{ROLE_LABELS[slot.role][0]}</span>
                    )}
                    <span className={styles.coord}>{slot.id}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {selectedSlot && (
            <div className={styles.slotPanel}>
              <strong>
                Слот {selectedSlot.id} · {ROLE_LABELS[selectedSlot.role]}
              </strong>
              {slotMap.get(selectedSlot.id) && (
                <button type="button" onClick={() => clearSlot(selectedSlot.id)}>
                  Убрать фигуру
                </button>
              )}
            </div>
          )}
        </div>

        <div className={styles.pool}>
          <h3>
            {selectedSlot
              ? `Доступно для роли «${ROLE_LABELS[selectedSlot.role]}»`
              : 'Выберите слот на доске'}
          </h3>
          {!selectedSlot && (
            <p className={styles.poolHint}>
              Клик по клетке → затем карта из списка, либо сначала карта, потом клетка.
            </p>
          )}
          <ul className={styles.poolList}>
            {(selectedSlot ? poolForSelected : []).map((def) => {
              const left = remainingFor(def.id);
              const selected = selectedPoolDef === def.id;
              return (
                <li key={def.id}>
                  <button
                    type="button"
                    className={[styles.poolCard, selected ? styles.poolCardActive : '']
                      .filter(Boolean)
                      .join(' ')}
                    disabled={left <= 0 && slotMap.get(selectedSlot!.id) !== def.id}
                    onClick={() => {
                      if (selectedSlot) {
                        placeOnSlot(selectedSlot, def.id);
                      } else {
                        setSelectedPoolDef(def.id);
                      }
                    }}
                  >
                    <span className={styles.poolGlyph}>
                      <PieceIcon defId={def.id} owner="white" />
                    </span>
                    <span className={styles.poolInfo}>
                      <strong>
                        {def.name}
                        {!def.isBase && <em> мод.</em>}
                      </strong>
                      <span>{def.description}</span>
                      <span className={styles.poolMeta}>
                        cost {def.cost} · осталось ×{Math.max(0, left)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <button
        type="button"
        className={styles.save}
        onClick={onSave}
        disabled={filled < totalSlots || overBudget}
      >
        Сохранить и к бою
      </button>
    </section>
  );
}
