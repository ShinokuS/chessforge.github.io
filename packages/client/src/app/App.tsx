import styles from './App.module.css';
import { useAppStore } from './store';
import { BattleView } from '../battle/BattleView';
import { CollectionView } from '../collection/CollectionView';
import { DeckBuilderView } from '../deck/DeckBuilderView';
import { LibraryView } from '../library/LibraryView';

export function App() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.mark}>♜</span>
          <h1>Chessforge</h1>
        </div>
        <nav className={styles.nav}>
          <button
            type="button"
            className={view === 'battle' ? styles.active : undefined}
            onClick={() => setView('battle')}
          >
            Бой
          </button>
          <button
            type="button"
            className={view === 'collection' ? styles.active : undefined}
            onClick={() => setView('collection')}
          >
            Коллекция
          </button>
          <button
            type="button"
            className={view === 'deck' ? styles.active : undefined}
            onClick={() => setView('deck')}
          >
            Колода
          </button>
          <button
            type="button"
            className={view === 'library' ? styles.active : undefined}
            onClick={() => setView('library')}
          >
            Библиотека
          </button>
        </nav>
      </header>
      <main className={styles.main}>
        {view === 'battle' && <BattleView />}
        {view === 'collection' && <CollectionView />}
        {view === 'deck' && <DeckBuilderView />}
        {view === 'library' && <LibraryView />}
      </main>
    </div>
  );
}
