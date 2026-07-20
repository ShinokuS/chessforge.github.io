import { useEffect, useState } from 'react';
import styles from './App.module.css';
import { useAppStore } from './store';
import { applySiteTheme, readStoredTheme, SITE_THEMES, type SiteTheme } from './theme';
import { AnalysisView } from '../analysis/AnalysisView';
import { BattleView } from '../battle/BattleView';
import { CollectionView } from '../collection/CollectionView';
import { DeckBuilderView } from '../deck/DeckBuilderView';
import { LibraryView } from '../library/LibraryView';

export function App() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const [theme, setTheme] = useState<SiteTheme>(() => readStoredTheme());

  useEffect(() => {
    applySiteTheme(theme);
  }, [theme]);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.mark}>♜</span>
          <h1>Chessforge</h1>
        </div>
        <div className={styles.headerRight}>
          <label className={styles.theme}>
            Тема
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as SiteTheme)}
              aria-label="Тема оформления"
            >
              {SITE_THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
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
              className={view === 'analysis' ? styles.active : undefined}
              onClick={() => setView('analysis')}
            >
              Анализ
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
        </div>
      </header>
      <main className={styles.main}>
        {view === 'battle' && <BattleView />}
        {view === 'analysis' && <AnalysisView />}
        {view === 'collection' && <CollectionView />}
        {view === 'deck' && <DeckBuilderView />}
        {view === 'library' && <LibraryView />}
      </main>
    </div>
  );
}
