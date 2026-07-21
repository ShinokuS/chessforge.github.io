import type { PieceInstance } from '@chessforge/engine';
import { getPieceDefinition } from '@chessforge/engine';
import styles from './BoardView.module.css';

type Props = {
  piece: PieceInstance;
};

/**
 * Micro status marks in the cell's top-right (mirrors tileMark top-left).
 * Hearts = HP above baseline (2 HP → 1♥, 3 HP → 2♥; 1 HP → none).
 */
export function PieceStatusMarks({ piece }: Props) {
  const def = getPieceDefinition(piece.defId);
  const hp = Math.max(0, Math.min(8, Math.floor(piece.hp)));
  const marks: { key: string; glyph: string; className: string; title: string }[] = [];

  if (piece.isRoyal && def.baseRole !== 'king') {
    marks.push({
      key: 'royal',
      glyph: '♛',
      className: styles.markRoyal!,
      title: 'Титул короля',
    });
  }
  if ((piece.frozenTurns ?? 0) > 0) {
    marks.push({
      key: 'freeze',
      glyph: '❄',
      className: styles.markFreeze!,
      title: `Заморозка: ${piece.frozenTurns}`,
    });
  }
  if ((piece.shieldTurns ?? 0) > 0) {
    marks.push({
      key: 'shield',
      glyph: '◈',
      className: styles.markShield!,
      title: `Щит: ${piece.shieldTurns}`,
    });
  }
  if (piece.spikeArmed) {
    marks.push({
      key: 'spike',
      glyph: '▴',
      className: styles.markSpike!,
      title:
        piece.spikeTicks >= 1
          ? 'Шипы: следующий ход смертелен'
          : 'Шипы: на клетке',
    });
  }
  if (piece.windPending) {
    marks.push({
      key: 'wind',
      glyph: '≋',
      className: styles.markWind!,
      title: 'Ветер: снос после хода соперника',
    });
  }
  if ((piece.invisibleTurns ?? 0) > 0) {
    marks.push({
      key: 'cloak',
      glyph: '◌',
      className: styles.markCloak!,
      title: `Невидимость: ${piece.invisibleTurns}`,
    });
  }
  if (piece.cursedCannotHarmId) {
    marks.push({
      key: 'curse',
      glyph: '✝',
      className: styles.markCurse!,
      title: 'Проклятие',
    });
  }
  if (piece.reflectAvailable && def.reflectDamageOnce) {
    marks.push({
      key: 'reflect',
      glyph: '↺',
      className: styles.markReflect!,
      title: 'Отражение урона',
    });
  }
  if (piece.doubleMoveArmed) {
    marks.push({
      key: 'double',
      glyph: '⚡',
      className: styles.markDouble!,
      title: 'Доп. ход',
    });
  }

  const heartCount = hp > 1 ? hp - 1 : 0;
  if (heartCount === 0 && marks.length === 0) return null;

  return (
    <span className={styles.pieceMarks} aria-hidden>
      {heartCount > 0 && (
        <span className={styles.pieceMarksHp} title={`HP ${piece.hp}/${def.maxHp}`}>
          {Array.from({ length: heartCount }, (_, i) => (
            <span key={i} className={styles.markHeart}>
              ♥
            </span>
          ))}
        </span>
      )}
      {marks.length > 0 && (
        <span className={styles.pieceMarksStatus}>
          {marks.map((m) => (
            <span key={m.key} className={m.className} title={m.title}>
              {m.glyph}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
