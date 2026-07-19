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

const ROLE_ORDER: PieceRole[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

export function CollectionView() {
  const cards = useAppStore((s) => s.cards);
  const repo = useAppStore((s) => s.repo);
  const refreshMeta = useAppStore((s) => s.refreshMeta);
  const [openId, setOpenId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const byRole = new Map<PieceRole, typeof cards>();
    for (const role of ROLE_ORDER) byRole.set(role, []);
    for (const card of cards) {
      const def = getPieceDefinition(card.defId);
      byRole.get(def.baseRole)?.push(card);
    }
    return ROLE_ORDER.map((role) => ({
      role,
      cards: byRole.get(role) ?? [],
    })).filter((g) => g.cards.length > 0);
  }, [cards]);

  return (
    <section className={styles.wrap}>
      <div className={styles.head}>
        <h2>Коллекция</h2>
        <p>
          Карты сгруппированы по базовой шахматной роли. Модификации занимают тот же слот
          при сборе колоды.
        </p>
        <button
          type="button"
          onClick={() => {
            repo.resetToStarter();
            refreshMeta();
          }}
        >
          Сбросить стартовый набор
        </button>
      </div>

      {grouped.map(({ role, cards: roleCards }) => (
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
                    <span className={styles.glyph}>
                      <PieceIcon defId={card.defId} owner="white" />
                    </span>
                    <span className={styles.body}>
                      <span className={styles.titleRow}>
                        <strong>{def.name}</strong>
                        {!def.isBase && <span className={styles.mod}>модификация</span>}
                      </span>
                      <span className={styles.meta}>
                        {def.rarity} · cost {def.cost} · ×{card.count} · слот:{' '}
                        {ROLE_LABELS[def.baseRole]}
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
      ))}
    </section>
  );
}
