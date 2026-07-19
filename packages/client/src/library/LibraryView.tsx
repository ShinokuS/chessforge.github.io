import styles from './LibraryView.module.css';
import { listTileDefinitions } from '@chessforge/engine';

const TILE_SWATCH: Record<string, string | undefined> = {
  plain: styles.swatchPlain,
  mud: styles.swatchMud,
  spikes: styles.swatchSpikes,
  mountain: styles.swatchMountain,
  cave: styles.swatchCave,
  lake: styles.swatchLake,
};

export function LibraryView() {
  const tiles = listTileDefinitions();

  return (
    <section className={styles.wrap}>
      <div className={styles.head}>
        <h2>Библиотека</h2>
        <p>Справочник клеток поля боя. Эффекты применяются движком, не UI.</p>
      </div>
      <ul className={styles.list}>
        {tiles.map((tile) => (
          <li key={tile.id} className={styles.card}>
            <div
              className={[styles.swatch, TILE_SWATCH[tile.id] ?? styles.swatchPlain]
                .filter(Boolean)
                .join(' ')}
              aria-hidden
            />
            <div>
              <h3>{tile.name}</h3>
              <p>{tile.description}</p>
              <p className={styles.meta}>
                id: {tile.id}
                {!tile.passable ? ' · непроходимо' : ''}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
