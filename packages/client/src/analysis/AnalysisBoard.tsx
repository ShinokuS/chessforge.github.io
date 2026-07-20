import { useState, type ReactNode } from 'react';
import {
  getPieceAuraOverlay,
  getPieceDefinition,
  getTileDefinition,
  getTileId,
  isPieceMarshSlowed,
  type Coord,
  type GameCommand,
  type MatchState,
} from '@chessforge/engine';
import boardStyles from '../battle/BoardView.module.css';
import { PieceIcon } from '../battle/PieceIcon';
import {
  ABILITY_LABEL,
  actionLabel,
  availableArmableActions,
  filterMovesForAbilityArm,
  legalMapFromMoves,
  type ArmedAction,
} from '../battle/abilities';
import {
  legalMovesFrom,
  moveToCommand,
  type AnalysisMode,
  type EditorBrush,
} from './analysisHelpers';

const TILE_MARK: Record<string, string> = {
  mud: '≈',
  spikes: '▴',
  mountain: '▲',
  cave: '◉',
  lake: '⁓',
  wind: '≋',
  forest: '♣',
  mushroom: '✦',
};

type AnalysisBoardProps = {
  state: MatchState;
  mode: AnalysisMode;
  brush: EditorBrush | null;
  flipped: boolean;
  lastMove: { from: Coord; to: Coord } | null;
  bestMove: GameCommand | null;
  onPlay: (command: GameCommand) => void;
  onEdit: (pos: Coord) => void;
};

export function AnalysisBoard({
  state,
  mode,
  brush,
  flipped,
  lastMove,
  bestMove,
  onPlay,
  onEdit,
}: AnalysisBoardProps) {
  const [selected, setSelected] = useState<Coord | null>(null);
  const [abilityArmed, setAbilityArmed] = useState<ArmedAction | null>(null);
  const [hovered, setHovered] = useState<Coord | null>(null);

  const allLegal =
    mode === 'play' && selected ? legalMovesFrom(state, selected) : [];
  const armableIds = availableArmableActions(allLegal);
  const legal = filterMovesForAbilityArm(allLegal, abilityArmed);
  const legalMap = legalMapFromMoves(legal);

  const selectedPiece = selected
    ? state.pieces.find((p) => p.pos.x === selected.x && p.pos.y === selected.y)
    : undefined;
  const showAbilityArm =
    mode === 'play' &&
    Boolean(selectedPiece) &&
    selectedPiece!.owner === state.activePlayer &&
    armableIds.length > 0;

  const onCellClick = (pos: Coord) => {
    if (mode === 'edit') {
      onEdit(pos);
      setSelected(null);
      setAbilityArmed(null);
      return;
    }
    if (state.phase !== 'play') return;

    if (selected && selected.x === pos.x && selected.y === pos.y) {
      setSelected(null);
      setAbilityArmed(null);
      return;
    }

    const move = legalMap.get(`${pos.x},${pos.y}`);
    if (selected && move) {
      onPlay(moveToCommand(move));
      setSelected(null);
      setAbilityArmed(null);
      return;
    }

    const clickedPiece = state.pieces.find((p) => p.pos.x === pos.x && p.pos.y === pos.y);
    if (selected && clickedPiece && abilityArmed) {
      const targetAbility = legal.find(
        (m) => m.abilityId === abilityArmed && m.targetPieceId === clickedPiece.id,
      );
      if (targetAbility) {
        onPlay(moveToCommand(targetAbility));
        setSelected(null);
        setAbilityArmed(null);
        return;
      }
    }

    if (clickedPiece && clickedPiece.owner === state.activePlayer) {
      setSelected(pos);
      setAbilityArmed(null);
      return;
    }
    setSelected(null);
    setAbilityArmed(null);
  };

  const { width, height } = state.board;
  const cells: ReactNode[] = [];
  const hoverTileId = hovered ? (getTileId(state.board, hovered) ?? 'plain') : null;
  const hoverTile = hoverTileId ? getTileDefinition(hoverTileId) : null;
  const hoverPiece = hovered
    ? state.pieces.find((p) => p.pos.x === hovered.x && p.pos.y === hovered.y)
    : null;
  const hoverDef = hoverPiece ? getPieceDefinition(hoverPiece.defId) : null;
  const hoverAura = hoverPiece ? getPieceAuraOverlay(hoverPiece, state.board) : null;
  const auraKeys = hoverAura
    ? new Set(hoverAura.cells.map((c) => `${c.x},${c.y}`))
    : null;
  const auraClass =
    hoverAura?.kind === 'marsh'
      ? boardStyles.auraMarsh
      : hoverAura?.kind === 'freeze'
        ? boardStyles.auraFreeze
        : hoverAura?.kind === 'heal'
          ? boardStyles.auraHeal
          : '';

  const yOrder = flipped
    ? Array.from({ length: height }, (_, i) => i)
    : Array.from({ length: height }, (_, i) => height - 1 - i);
  const xOrder = flipped
    ? Array.from({ length: width }, (_, i) => width - 1 - i)
    : Array.from({ length: width }, (_, i) => i);

  const bestFrom =
    bestMove?.type === 'move' ? bestMove.from : null;
  const bestTo = bestMove?.type === 'move' ? bestMove.to : null;

  for (const y of yOrder) {
    for (const x of xOrder) {
      const pos = { x, y };
      const tileId = getTileId(state.board, pos) ?? 'plain';
      const piece = state.pieces.find((p) => p.pos.x === x && p.pos.y === y);
      const isDark = (x + y) % 2 === 0;
      const isSelected = selected?.x === x && selected?.y === y;
      const isLastFrom = lastMove?.from.x === x && lastMove?.from.y === y;
      const isLastTo = lastMove?.to.x === x && lastMove?.to.y === y;
      const isBestFrom = bestFrom?.x === x && bestFrom?.y === y;
      const isBestTo = bestTo?.x === x && bestTo?.y === y;
      const move = mode === 'play' ? legalMap.get(`${x},${y}`) : undefined;
      const tileDef = getTileDefinition(tileId);
      const spiked = Boolean(piece?.spikeArmed);
      const frozen = (piece?.frozenTurns ?? 0) > 0;
      const shielded = (piece?.shieldTurns ?? 0) > 0;
      const cloaked = (piece?.invisibleTurns ?? 0) > 0;
      const cursed = Boolean(piece?.cursedCannotHarmId);
      const inAura = Boolean(auraKeys?.has(`${x},${y}`));

      const classNames = [
        boardStyles.cell,
        isDark ? boardStyles.dark : boardStyles.light,
        tileId === 'mud' ? boardStyles.mud : '',
        tileId === 'spikes' ? boardStyles.spikes : '',
        tileId === 'mountain' ? boardStyles.mountain : '',
        tileId === 'cave' ? boardStyles.cave : '',
        tileId === 'lake' ? boardStyles.lake : '',
        tileId === 'wind' ? boardStyles.wind : '',
        tileId === 'forest' ? boardStyles.forest : '',
        tileId === 'mushroom' ? boardStyles.mushroom : '',
        isSelected ? boardStyles.selected : '',
        isLastFrom || isLastTo ? boardStyles.lastMove : '',
        move?.abilityId || move?.push ? boardStyles.canAbility : '',
        move && !move.captures && !move.abilityId && !move.push
          ? boardStyles.canMove
          : '',
        move?.captures ? boardStyles.canCapture : '',
        spiked ? boardStyles.spikeDoom : '',
        frozen ? boardStyles.freezeDoom : '',
        shielded ? boardStyles.shieldAura : '',
        cursed ? boardStyles.cursed : '',
        cloaked ? boardStyles.cloakedMine : '',
        inAura ? auraClass : '',
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
          onMouseLeave={() =>
            setHovered((h) => (h?.x === x && h?.y === y ? null : h))
          }
          onFocus={() => setHovered(pos)}
          aria-label={`${tileDef.name}, клетка ${x},${y}`}
          data-best-from={isBestFrom ? '1' : undefined}
          data-best-to={isBestTo ? '1' : undefined}
        >
          {piece && (
            <PieceIcon defId={piece.defId} owner={piece.owner} className={boardStyles.piece} />
          )}
          {tileId !== 'plain' && (
            <span className={boardStyles.tileMark}>{TILE_MARK[tileId] ?? '·'}</span>
          )}
          {isBestTo && <span className="analysisBestHint" aria-hidden />}
        </button>,
      );
    }
  }

  return (
    <div className={boardStyles.wrap}>
      <div
        className={boardStyles.board}
        style={{
          gridTemplateColumns: `repeat(${width}, 1fr)`,
          gridTemplateRows: `repeat(${height}, 1fr)`,
        }}
      >
        {cells}
      </div>

      <aside className={boardStyles.inspect} aria-live="polite">
        {mode === 'edit' && (
          <p className={boardStyles.inspectIdle}>
            {brush?.kind === 'trash'
              ? 'Кликните клетку, чтобы убрать фигуру.'
              : brush?.kind === 'tile'
                ? 'Кликните клетку, чтобы поставить тайл.'
                : brush?.kind === 'piece'
                  ? 'Кликните клетку, чтобы поставить фигуру.'
                  : 'Выберите фигуру или тайл в панели редактора.'}
          </p>
        )}

        {showAbilityArm && (
          <div className={boardStyles.abilityArm}>
            <p className={boardStyles.abilityArmTitle}>Способность</p>
            {armableIds.map((id) => {
              const on = abilityArmed === id;
              return (
                <label key={id} className={boardStyles.abilityToggle}>
                  <span className={boardStyles.abilityToggleLabel}>{actionLabel(id)}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    className={on ? boardStyles.switchOn : boardStyles.switchOff}
                    onClick={() => setAbilityArmed(on ? null : id)}
                  >
                    <span className={boardStyles.switchKnob} />
                  </button>
                </label>
              );
            })}
          </div>
        )}

        {hoverTile ? (
          <>
            <h3>{hoverTile.name}</h3>
            <p>{hoverTile.description}</p>
            {hoverPiece && isPieceMarshSlowed(state, hoverPiece) && (
              <p className={boardStyles.warn}>Эффект Топи: ход ограничен одной клеткой.</p>
            )}
            {hoverPiece && hoverDef && (
              <div className={boardStyles.inspectPiece}>
                <strong>
                  {hoverDef.name}
                  {' · '}
                  {hoverPiece.owner === 'white' ? 'белые' : 'чёрные'}
                </strong>
                <p>{hoverDef.description}</p>
                <p className={boardStyles.hp}>
                  HP: {hoverPiece.hp}/{hoverDef.maxHp}
                </p>
                {hoverDef.abilities?.map((ab) => (
                  <p key={ab.id} className={boardStyles.abilityReady}>
                    {ABILITY_LABEL[ab.id] ?? ab.id}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : (
          mode === 'play' && (
            <p className={boardStyles.inspectIdle}>
              Ход {state.activePlayer === 'white' ? 'белых' : 'чёрных'}. Кликните фигуру и цель.
            </p>
          )
        )}
      </aside>
    </div>
  );
}
