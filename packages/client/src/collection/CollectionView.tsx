import { useMemo, useState } from 'react';
import styles from './CollectionView.module.css';
import {
  ROLE_LABELS,
  getPieceDefinition,
  type PieceRole,
} from '@chessforge/engine';
import { useAppStore } from '../app/store';
import { PieceIcon } from '../battle/PieceIcon';
import { MoveDiagram } from './MoveDiagram';
import { CostIcon, CountIcon } from './CollectionStatIcons';

const ROLE_ORDER: PieceRole[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

function formatCost(cost: number): string {
  if (cost === 0) return '0';
  if (cost > 0) return `+${cost}`;
  return String(cost);
}

export function CollectionView() {
  const cards = useAppStore((s) => s.cards);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byRole = new Map<PieceRole, typeof cards>();
    for (const role of ROLE_ORDER) byRole.set(role, []);
    for (const card of cards) {
      const def = getPieceDefinition(card.defId);
      if (q) {
        const hay = `${def.name} ${def.id} ${def.description}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      byRole.get(def.baseRole)?.push(card);
    }
    return ROLE_ORDER.map((role) => ({
      role,
      cards: byRole.get(role) ?? [],
    })).filter((g) => g.cards.length > 0);
  }, [cards, query]);

  return (
    <section className={styles.wrap}>
      <div className={styles.head}>
        <h2>Коллекция</h2>
        <p>
          Карты сгруппированы по базовой шахматной роли. Модификации занимают тот же слот
          при сборе колоды.
        </p>
        <label className={styles.search}>
          <span className={styles.searchLabel}>Поиск</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Название фигуры…"
            autoComplete="off"
          />
        </label>
      </div>

      {grouped.length === 0 ? (
        <p className={styles.empty}>Ничего не найдено по запросу «{query.trim()}».</p>
      ) : (
        grouped.map(({ role, cards: roleCards }) => (
          <div key={role} className={styles.group}>
            <h3 className={styles.groupTitle}>{ROLE_LABELS[role]}</h3>
            <ul className={styles.list}>
              {roleCards.map((card) => {
                const def = getPieceDefinition(card.defId);
                const open = openId === card.defId;
                return (
                  <li
                    key={card.defId}
                    className={[styles.item, open ? styles.itemOpen : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <button
                      type="button"
                      className={styles.itemHeader}
                      onClick={() => setOpenId(open ? null : card.defId)}
                      aria-expanded={open}
                    >
                      <span className={styles.glyphFrame}>
                        <PieceIcon defId={card.defId} owner="white" className={styles.glyph} />
                      </span>
                      <span className={styles.body}>
                        <span className={styles.titleRow}>
                          <strong>{def.name}</strong>
                        </span>
                        <span className={styles.stats}>
                          {!def.isBase && (
                            <span
                              className={[
                                styles.stat,
                                styles.statCost,
                                def.cost < 0 ? styles.statCostCredit : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              <span className={styles.statLabel}>
                                <CostIcon className={styles.statIcon ?? ''} />
                                Стоимость
                              </span>
                              <span className={styles.statValue}>{formatCost(def.cost)}</span>
                            </span>
                          )}
                          <span className={styles.stat}>
                            <span className={styles.statLabel}>
                              <CountIcon className={styles.statIcon ?? ''} />
                              Количество
                            </span>
                            <span className={styles.statValue}>{card.count}</span>
                          </span>
                        </span>
                      </span>
                    </button>
                    {open && (
                      <div className={styles.details}>
                        <p className={styles.desc}>{def.description}</p>
                        <MoveDiagram def={def} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
