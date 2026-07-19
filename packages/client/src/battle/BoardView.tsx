import { useState, type ReactNode } from 'react';
import styles from './BoardView.module.css';
import {
  getPieceDefinition,
  getTileDefinition,
  getTileId,
  type Coord,
} from '@chessforge/engine';
import { useAppStore } from '../app/store';
import { PieceIcon } from './PieceIcon';

const TILE_MARK: Record<string, string> = {
  mud: '≈',
  spikes: '▴',
  mountain: '▲',
  cave: '◉',
  lake: '⁓',
};

const ABILITY_LABEL: Record<string, string> = {
  retreat: 'Отступление',
  royalWarp: 'Телепорт к королю',
  allyLeap: 'Прыжок через союзника',
};

export function BoardView() {
  const state = useAppStore((s) => s.state);
  const selected = useAppStore((s) => s.selected);
  const lastMove = useAppStore((s) => s.lastMove);
  const setSelected = useAppStore((s) => s.setSelected);
  const submitMove = useAppStore((s) => s.submitMove);
  const session = useAppStore((s) => s.session);
  const online = useAppStore((s) => s.online);
  const battleMode = useAppStore((s) => s.battleMode);
  const canControl = useAppStore((s) => s.canControl);
  const [hovered, setHovered] = useState<Coord | null>(null);

  const activeSession = battleMode === 'online' ? online : session;
  const myColor = battleMode === 'online' ? online.getMyColor() : 'white';
  const legal = selected ? activeSession.getLegalMovesFrom(selected) : [];
  const legalMap = new Map(legal.map((m) => [`${m.to.x},${m.to.y}`, m]));

  const onCellClick = (pos: Coord) => {
    if (state.phase !== 'play') return;
    if (battleMode === 'online' && online.getStatus() !== 'playing') return;
    if (!myColor || state.activePlayer !== myColor) return;

    const move = legalMap.get(`${pos.x},${pos.y}`);
    if (selected && move) {
      submitMove(pos);
      return;
    }

    const piece = state.pieces.find((p) => p.pos.x === pos.x && p.pos.y === pos.y);
    if (piece && canControl(piece.owner)) {
      setSelected(pos);
      return;
    }
    setSelected(null);
  };

  const { width, height } = state.board;
  const flip = myColor === 'black';
  const cells: ReactNode[] = [];

  const yOrder = flip
    ? Array.from({ length: height }, (_, i) => i)
    : Array.from({ length: height }, (_, i) => height - 1 - i);
  const xOrder = flip
    ? Array.from({ length: width }, (_, i) => width - 1 - i)
    : Array.from({ length: width }, (_, i) => i);

  for (const y of yOrder) {
    for (const x of xOrder) {
      const pos = { x, y };
      const tileId = getTileId(state.board, pos) ?? 'plain';
      const piece = state.pieces.find((p) => p.pos.x === x && p.pos.y === y);
      const isDark = (x + y) % 2 === 1;
      const isSelected = selected?.x === x && selected?.y === y;
      const isLastFrom = lastMove?.from.x === x && lastMove?.from.y === y;
      const isLastTo = lastMove?.to.x === x && lastMove?.to.y === y;
      const move = legalMap.get(`${x},${y}`);
      const tileDef = getTileDefinition(tileId);
      const spiked = Boolean(piece?.spikeArmed);

      const classNames = [
        styles.cell,
        isDark ? styles.dark : styles.light,
        tileId === 'mud' ? styles.mud : '',
        tileId === 'spikes' ? styles.spikes : '',
        tileId === 'mountain' ? styles.mountain : '',
        tileId === 'cave' ? styles.cave : '',
        tileId === 'lake' ? styles.lake : '',
        isSelected ? styles.selected : '',
        isLastFrom || isLastTo ? styles.lastMove : '',
        move && !move.captures ? styles.canMove : '',
        move?.captures ? styles.canCapture : '',
        spiked ? styles.spikeDoom : '',
      ]
        .filter(Boolean)
        .join(' ');

      cells.push(
        <button
          key={`${x},${y}`}
          type="button"
          className={classNames}
          onClick={() => onCellClick(pos)}
          onMouseEnter={() => setHovered(pos)}
          onMouseLeave={() => setHovered((h) => (h?.x === x && h?.y === y ? null : h))}
          onFocus={() => setHovered(pos)}
          aria-label={`${tileDef.name}, клетка ${x},${y}`}
        >
          {piece && (
            <PieceIcon defId={piece.defId} owner={piece.owner} className={styles.piece} />
          )}
          {tileId !== 'plain' && (
            <span className={styles.tileMark}>{TILE_MARK[tileId] ?? '·'}</span>
          )}
        </button>,
      );
    }
  }

  const hoverTileId = hovered
    ? (getTileId(state.board, hovered) ?? 'plain')
    : null;
  const hoverTile = hoverTileId ? getTileDefinition(hoverTileId) : null;
  const hoverPiece = hovered
    ? state.pieces.find((p) => p.pos.x === hovered.x && p.pos.y === hovered.y)
    : null;
  const hoverDef = hoverPiece ? getPieceDefinition(hoverPiece.defId) : null;

  return (
    <div className={styles.wrap}>
      <div
        className={styles.board}
        style={{
          gridTemplateColumns: `repeat(${width}, 1fr)`,
          gridTemplateRows: `repeat(${height}, 1fr)`,
        }}
      >
        {cells}
      </div>

      <aside className={styles.inspect} aria-live="polite">
        {hoverTile ? (
          <>
            <h3>{hoverTile.name}</h3>
            <p>{hoverTile.description}</p>
            {hoverPiece?.spikeArmed && (
              <p className={styles.warn}>
                {hoverPiece.spikeTicks >= 1
                  ? 'Если не уйдёт в этот ход — погибнет в начале следующего.'
                  : 'На шипах: есть ещё один свой ход, чтобы уйти.'}
              </p>
            )}
            {hoverPiece && hoverDef && (
              <div className={styles.inspectPiece}>
                <strong>
                  {hoverDef.name}
                  {' · '}
                  {hoverPiece.owner === 'white' ? 'белые' : 'чёрные'}
                </strong>
                <p>{hoverDef.description}</p>
                <p className={styles.hp}>
                  HP: {hoverPiece.hp}/{hoverDef.maxHp}
                  {hoverDef.maxHp > 1 ? ' (нужно несколько ударов)' : ''}
                </p>
                {hoverDef.abilities?.map((ab) => {
                  const used = Boolean(hoverPiece.abilitiesUsed[ab.id]);
                  return (
                    <p key={ab.id} className={used ? styles.abilityUsed : styles.abilityReady}>
                      {ABILITY_LABEL[ab.id] ?? ab.id}: {used ? 'потрачена' : 'доступна'}
                    </p>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <p className={styles.inspectIdle}>Наведите на клетку, чтобы увидеть её эффект.</p>
        )}
      </aside>
    </div>
  );
}
