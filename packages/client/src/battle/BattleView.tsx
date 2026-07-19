import styles from './BattleView.module.css';
import { BoardView } from './BoardView';
import { useAppStore } from '../app/store';

export function BattleView() {
  const state = useAppStore((s) => s.state);
  const lastError = useAppStore((s) => s.lastError);
  const restart = useAppStore((s) => s.restart);

  const status =
    state.phase === 'gameOver'
      ? `Победа: ${state.winner === 'white' ? 'белые' : 'чёрные'}`
      : `Ход ${state.turn} · ${state.activePlayer === 'white' ? 'белые' : 'чёрные (ИИ)'}`;

  return (
    <section className={styles.wrap}>
      <div className={styles.hud}>
        <div>
          <h2 className={styles.title}>Поле боя</h2>
          <p className={styles.status}>{status}</p>
          {lastError && <p className={styles.error}>{lastError}</p>}
        </div>
        <button type="button" className={styles.restart} onClick={restart}>
          Новая партия
        </button>
      </div>
      <BoardView />
      <p className={styles.hint}>
        Выберите фигуру, затем подсвеченную клетку. Наведите на поле — справа описание клетки и
        фигуры.
      </p>
    </section>
  );
}
