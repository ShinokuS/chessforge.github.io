import { useEffect, useId, useRef, useState } from 'react';
import {
  deleteSavedGame,
  formatSavedAt,
  listSavedGames,
  type SavedGame,
} from '../repositories/savedGames';
import { deleteAnalysisSession } from './analysisSessionStorage';
import styles from './SavedGamesMenu.module.css';

type Props = {
  activeGameId: string | null;
  onLoad: (game: SavedGame) => void;
  onActiveCleared?: () => void;
};

export function SavedGamesMenu({ activeGameId, onLoad, onActiveCleared }: Props) {
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState<SavedGame[]>(() => listSavedGames());
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const refresh = () => setGames(listSavedGames());

  useEffect(() => {
    if (!open) return;
    refresh();
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={open ? styles.btnOn : styles.btn}
        aria-expanded={open}
        aria-controls={open ? titleId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        Партии
        {games.length > 0 && <span className={styles.count}>{games.length}</span>}
      </button>

      {open && (
        <div
          className={styles.panel}
          id={titleId}
          role="dialog"
          aria-label="Сохранённые партии"
        >
          <div className={styles.head}>
            <h3 className={styles.title}>Сохранённые партии</h3>
            <button type="button" className={styles.refresh} onClick={refresh}>
              Обновить
            </button>
          </div>

          {games.length === 0 ? (
            <p className={styles.empty}>
              Пока пусто. После партии нажмите «Сохранить и проанализировать».
            </p>
          ) : (
            <ul className={styles.list}>
              {games.map((game) => (
                <li key={game.id} className={styles.item}>
                  <button
                    type="button"
                    className={
                      activeGameId === game.id ? styles.gameActive : styles.gameBtn
                    }
                    onClick={() => {
                      onLoad(game);
                      setOpen(false);
                    }}
                  >
                    <span className={styles.gameTitle}>{game.title}</span>
                    <span className={styles.gameMeta}>{formatSavedAt(game.savedAt)}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.delete}
                    title="Удалить"
                    onClick={() => {
                      deleteSavedGame(game.id);
                      deleteAnalysisSession(game.id);
                      if (activeGameId === game.id) onActiveCleared?.();
                      refresh();
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
