import { useState, type ReactNode } from 'react';
import styles from './BoardView.module.css';
import {
  getPieceAuraOverlay,
  getPieceDefinition,
  getTileDefinition,
  getTileId,
  isPieceMarshSlowed,
  type Coord,
} from '@chessforge/engine';
import { useAppStore } from '../app/store';
import { lastMoveAtReplayIndex } from './replay';
import { PieceIcon } from './PieceIcon';
import { PieceStatusMarks } from './PieceStatusMarks';
import {
  ABILITY_LABEL,
  actionLabel,
  availableArmableActions,
  filterMovesForAbilityArm,
  legalMapFromMoves,
  type ArmedAction,
} from './abilities';

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

export function BoardView() {
  const liveState = useAppStore((s) => s.state);
  const analysis = useAppStore((s) => s.analysis);
  const selected = useAppStore((s) => s.selected);
  const abilityArmed = useAppStore((s) => s.abilityArmed);
  const setAbilityArmed = useAppStore((s) => s.setAbilityArmed);
  const liveLastMove = useAppStore((s) => s.lastMove);
  const setSelected = useAppStore((s) => s.setSelected);
  const submitMove = useAppStore((s) => s.submitMove);
  const session = useAppStore((s) => s.session);
  const online = useAppStore((s) => s.online);
  const battleMode = useAppStore((s) => s.battleMode);
  const canControl = useAppStore((s) => s.canControl);
  const endBanner = useAppStore((s) => s.endBanner);
  const liveReviewCursor = useAppStore((s) => s.liveReviewCursor);
  const liveReviewPositions = useAppStore((s) => s.liveReviewPositions);
  const [hovered, setHovered] = useState<Coord | null>(null);

  const reviewingAnalysis = analysis.status === 'done' || analysis.status === 'running';
  const reviewingLive =
    !reviewingAnalysis &&
    liveReviewCursor !== 'live' &&
    liveReviewPositions.length > 1;
  const reviewing = reviewingAnalysis || reviewingLive;
  const state = reviewingAnalysis && analysis.positions[analysis.cursor]
    ? analysis.positions[analysis.cursor]!
    : reviewingLive
      ? liveReviewPositions[liveReviewCursor]!
      : liveState;

  const lastMoveRaw = (() => {
    if (reviewingAnalysis) {
      if (analysis.cursor <= 0) return null;
      const ply = analysis.plies[analysis.cursor - 1];
      if (!ply || ply.played.type !== 'move') return null;
      return { from: ply.played.from, to: ply.played.to };
    }
    if (reviewingLive) {
      const replay =
        battleMode === 'online' ? online.getReplay() : session.getReplay();
      if (!replay) return null;
      return lastMoveAtReplayIndex(replay.commands, liveReviewCursor);
    }
    return liveLastMove;
  })();

  const activeSession = battleMode === 'online' ? online : session;
  const myColor = battleMode === 'online' ? online.getMyColor() : 'white';

  // Don't flash from/to of an enemy cloaked pawn — that would reveal its path.
  const lastMove = (() => {
    if (!lastMoveRaw || !myColor) return lastMoveRaw;
    const atTo = state.pieces.find(
      (p) => p.pos.x === lastMoveRaw.to.x && p.pos.y === lastMoveRaw.to.y,
    );
    if (
      atTo &&
      atTo.owner !== myColor &&
      (atTo.invisibleTurns ?? 0) > 0
    ) {
      return null;
    }
    return lastMoveRaw;
  })();
  const allLegal =
    selected && !endBanner && !reviewing ? activeSession.getLegalMovesFrom(selected) : [];
  const armableIds = availableArmableActions(allLegal);
  const legal = filterMovesForAbilityArm(allLegal, abilityArmed);
  const legalMap = legalMapFromMoves(legal);

  const selectedPiece = selected
    ? state.pieces.find((p) => p.pos.x === selected.x && p.pos.y === selected.y)
    : undefined;
  const showAbilityArm =
    Boolean(selectedPiece) &&
    canControl(selectedPiece!.owner) &&
    armableIds.length > 0 &&
    !reviewing &&
    !endBanner;

  const aiPlaying = useAppStore((s) => s.aiPlaying);

  const onToggleAbility = (id: ArmedAction) => {
    setAbilityArmed(abilityArmed === id ? null : id);
  };

  const onCellClick = (pos: Coord) => {
    if (reviewing || endBanner || state.phase !== 'play') return;
    if (battleMode === 'ai' && !aiPlaying) return;
    if (battleMode === 'online' && online.getStatus() !== 'playing') return;
    if (!myColor || state.activePlayer !== myColor) return;

    if (selected && selected.x === pos.x && selected.y === pos.y) {
      setSelected(null);
      return;
    }

    const move = legalMap.get(`${pos.x},${pos.y}`);
    if (selected && move) {
      submitMove(pos, move.abilityId);
      return;
    }

    const clickedPiece = state.pieces.find((p) => p.pos.x === pos.x && p.pos.y === pos.y);
    if (selected && clickedPiece && abilityArmed) {
      const targetAbility = legal.find(
        (m) => m.abilityId === abilityArmed && m.targetPieceId === clickedPiece.id,
      );
      if (targetAbility?.abilityId) {
        submitMove(pos, targetAbility.abilityId);
        return;
      }
    }

    const piece = clickedPiece;
    if (piece && canControl(piece.owner)) {
      setSelected(pos);
      return;
    }
    setSelected(null);
  };

  const { width, height } = state.board;
  const flip = myColor === 'black';
  const cells: ReactNode[] = [];

  const hoverTileId = hovered
    ? (getTileId(state.board, hovered) ?? 'plain')
    : null;
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
      ? styles.auraMarsh
      : hoverAura?.kind === 'freeze'
        ? styles.auraFreeze
        : hoverAura?.kind === 'heal'
          ? styles.auraHeal
          : '';

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
      const isDark = (x + y) % 2 === 0;
      const isSelected = selected?.x === x && selected?.y === y;
      const isLastFrom = lastMove?.from.x === x && lastMove?.from.y === y;
      const isLastTo = lastMove?.to.x === x && lastMove?.to.y === y;
      const move = legalMap.get(`${x},${y}`);
      const tileDef = getTileDefinition(tileId);
      const spiked = Boolean(piece?.spikeArmed);
      const frozen = (piece?.frozenTurns ?? 0) > 0;
      const shielded = (piece?.shieldTurns ?? 0) > 0;
      const cloaked = (piece?.invisibleTurns ?? 0) > 0;
      const cursed = Boolean(piece?.cursedCannotHarmId);
      const hiddenFromMe = Boolean(
        piece && cloaked && piece.owner !== myColor && !reviewing,
      );
      const cloakedMine = Boolean(piece && cloaked && piece.owner === myColor);
      const inAura = Boolean(auraKeys?.has(`${x},${y}`));

      const classNames = [
        styles.cell,
        isDark ? styles.dark : styles.light,
        tileId === 'mud' ? styles.mud : '',
        tileId === 'spikes' ? styles.spikes : '',
        tileId === 'mountain' ? styles.mountain : '',
        tileId === 'cave' ? styles.cave : '',
        tileId === 'lake' ? styles.lake : '',
        tileId === 'wind' ? styles.wind : '',
        tileId === 'forest' ? styles.forest : '',
        tileId === 'mushroom' ? styles.mushroom : '',
        isSelected ? styles.selected : '',
        isLastFrom || isLastTo ? styles.lastMove : '',
        move?.abilityId || move?.push ? styles.canAbility : '',
        move && !move.captures && !move.abilityId && !move.push ? styles.canMove : '',
        move?.captures ? styles.canCapture : '',
        spiked ? styles.spikeDoom : '',
        frozen ? styles.freezeDoom : '',
        shielded ? styles.shieldAura : '',
        cursed ? styles.cursed : '',
        cloakedMine ? styles.cloakedMine : '',
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
          onMouseLeave={() => setHovered((h) => (h?.x === x && h?.y === y ? null : h))}
          onFocus={() => setHovered(pos)}
          aria-label={`${tileDef.name}, клетка ${x},${y}`}
        >
          {piece && !hiddenFromMe && (
            <>
              <PieceIcon defId={piece.defId} owner={piece.owner} className={styles.piece} />
              <PieceStatusMarks piece={piece} />
            </>
          )}
          {tileId !== 'plain' && (
            <span className={styles.tileMark}>{TILE_MARK[tileId] ?? '·'}</span>
          )}
        </button>,
      );
    }
  }

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
        {showAbilityArm && (
          <div className={styles.abilityArm}>
            <p className={styles.abilityArmTitle}>Способность</p>
            <p className={styles.abilityArmHint}>
              {abilityArmed
                ? 'Выберите цель способности на доске.'
                : 'Включите, чтобы применить вместо обычного хода.'}
            </p>
            {armableIds.map((id) => {
              const on = abilityArmed === id;
              return (
                <label key={id} className={styles.abilityToggle}>
                  <span className={styles.abilityToggleLabel}>{actionLabel(id)}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    className={on ? styles.switchOn : styles.switchOff}
                    onClick={() => onToggleAbility(id)}
                  >
                    <span className={styles.switchKnob} />
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
            {hoverAura && (
              <p className={styles.auraHint}>
                {hoverAura.kind === 'marsh' &&
                  `Аура топи: радиус ${hoverAura.radius} (враги замедлены)`}
                {hoverAura.kind === 'freeze' &&
                  `Зона заморозки: радиус ${hoverAura.radius}`}
                {hoverAura.kind === 'heal' &&
                  `Зона лечения: радиус ${hoverAura.radius}`}
              </p>
            )}
            {hoverPiece?.spikeArmed && (
              <p className={styles.warn}>
                {hoverPiece.spikeTicks >= 1
                  ? 'Если не уйдёт в этот ход — погибнет в начале следующего.'
                  : 'На шипах: есть ещё один свой ход, чтобы уйти.'}
              </p>
            )}
            {(hoverPiece?.frozenTurns ?? 0) > 0 && (
              <p className={styles.warn}>Заморожена: не может ходить в этот ход.</p>
            )}
            {hoverPiece && isPieceMarshSlowed(state, hoverPiece) && (
              <p className={styles.warn}>
                Эффект Топи: ход ограничен одной клеткой (как на топи).
              </p>
            )}
            {(hoverPiece?.shieldTurns ?? 0) > 0 && (
              <p className={styles.warn}>Щит леса: неуязвима к ударам и заморозке.</p>
            )}
            {hoverPiece && (hoverPiece.freezeCooldown ?? 0) > 0 && hoverDef?.freezeInsteadOfCapture && (
              <p className={styles.warn}>
                Перезарядка заморозки: ещё {hoverPiece.freezeCooldown} ход(а).
              </p>
            )}
            {hoverPiece?.windPending && (
              <p className={styles.warn}>
                Ветер: после хода противника будет снос назад, если клетка свободна.
              </p>
            )}
            {hoverPiece && (hoverPiece.invisibleTurns ?? 0) > 0 && (
              <p className={styles.warn}>
                Невидима для соперника ещё {hoverPiece.invisibleTurns} полуход(а).
              </p>
            )}
            {hoverPiece?.cursedCannotHarmId && (
              <p className={styles.warn}>
                Проклятие: эта фигура не может вредить указанному слону.
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
                  {hoverPiece.isRoyal ? ' · титул короля' : ''}
                  {hoverPiece.promotesToBaseQueen ? ' · назначена на ферзя' : ''}
                  {hoverDef.reflectDamageOnce
                    ? hoverPiece.reflectAvailable
                      ? ' · отражение готово'
                      : ' · отражение потрачено'
                    : ''}
                </p>
                {hoverDef.abilities?.map((ab) => {
                  const cd = hoverPiece.abilityCooldowns?.[ab.id] ?? 0;
                  const used = Boolean(hoverPiece.abilitiesUsed[ab.id]);
                  const status =
                    cd > 0
                      ? `перезарядка ${cd}`
                      : used
                        ? 'потрачена'
                        : 'доступна';
                  return (
                    <p
                      key={ab.id}
                      className={used || cd > 0 ? styles.abilityUsed : styles.abilityReady}
                    >
                      {ABILITY_LABEL[ab.id] ?? ab.id}: {status}
                    </p>
                  );
                })}
                {hoverDef.pushForward && (
                  <p className={styles.abilityReady}>Таран: толчок вперёд доступен</p>
                )}
                {hoverDef.freezeInsteadOfCapture && (
                  <p
                    className={
                      (hoverPiece.freezeCooldown ?? 0) > 0
                        ? styles.abilityUsed
                        : styles.abilityReady
                    }
                  >
                    Заморозка:{' '}
                    {(hoverPiece.freezeCooldown ?? 0) > 0
                      ? `перезарядка ${hoverPiece.freezeCooldown}`
                      : 'готова'}
                  </p>
                )}
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
