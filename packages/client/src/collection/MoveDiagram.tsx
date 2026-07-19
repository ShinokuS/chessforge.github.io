import type { ReactNode } from 'react';
import type { Coord, MovementPattern, PieceDefinition } from '@chessforge/engine';
import styles from './MoveDiagram.module.css';
import { PieceIcon } from '../battle/PieceIcon';

const SIZE = 7;
const ORIGIN = Math.floor(SIZE / 2);

type CellKind = 'empty' | 'quiet' | 'capture' | 'both';

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function inBoard(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE;
}

function expandPattern(
  pattern: MovementPattern,
  quiet: Set<string>,
  capture: Set<string>,
  mode: 'quiet' | 'capture' | 'both',
): void {
  if (pattern.kind === 'conditional') {
    // Show first-move options as normal quiet squares in the diagram
    for (const nested of pattern.patterns) {
      expandPattern(nested, quiet, capture, mode);
    }
    return;
  }

  if (pattern.kind === 'leap') {
    for (const off of pattern.offsets) {
      const x = ORIGIN + off.x;
      const y = ORIGIN + off.y;
      if (!inBoard(x, y)) continue;
      const k = key(x, y);
      if (mode === 'quiet' || mode === 'both') quiet.add(k);
      if (mode === 'capture' || mode === 'both') capture.add(k);
    }
    return;
  }

  const range = Math.min(pattern.maxRange, ORIGIN);
  for (const dir of pattern.directions) {
    for (let step = 1; step <= range; step++) {
      const x = ORIGIN + dir.x * step;
      const y = ORIGIN + dir.y * step;
      if (!inBoard(x, y)) break;
      const k = key(x, y);
      if (mode === 'quiet' || mode === 'both') quiet.add(k);
      if (mode === 'capture' || mode === 'both') capture.add(k);
    }
  }
}

function buildCells(def: PieceDefinition): Map<string, CellKind> {
  const quiet = new Set<string>();
  const capture = new Set<string>();

  if (def.splitCapture && def.captureOffsets) {
    for (const pattern of def.movement) {
      expandPattern(pattern, quiet, capture, 'quiet');
    }
    for (const off of def.captureOffsets) {
      const x = ORIGIN + off.x;
      const y = ORIGIN + off.y;
      if (inBoard(x, y)) capture.add(key(x, y));
    }
  } else {
    for (const pattern of def.movement) {
      expandPattern(pattern, quiet, capture, 'both');
    }
  }

  const cells = new Map<string, CellKind>();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const k = key(x, y);
      const q = quiet.has(k);
      const c = capture.has(k);
      if (q && c) cells.set(k, 'both');
      else if (c) cells.set(k, 'capture');
      else if (q) cells.set(k, 'quiet');
      else cells.set(k, 'empty');
    }
  }
  return cells;
}

type MoveDiagramProps = {
  def: PieceDefinition;
};

export function MoveDiagram({ def }: MoveDiagramProps) {
  const cells = buildCells(def);
  const origin: Coord = { x: ORIGIN, y: ORIGIN };

  const rows: ReactNode[] = [];
  for (let y = SIZE - 1; y >= 0; y--) {
    for (let x = 0; x < SIZE; x++) {
      const kind = cells.get(key(x, y)) ?? 'empty';
      const isOrigin = x === origin.x && y === origin.y;
      const isDark = (x + y) % 2 === 1;
      rows.push(
        <div
          key={key(x, y)}
          className={[
            styles.cell,
            isDark ? styles.dark : styles.light,
            kind === 'quiet' ? styles.quiet : '',
            kind === 'capture' ? styles.capture : '',
            kind === 'both' ? styles.both : '',
            isOrigin ? styles.origin : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {isOrigin && <PieceIcon defId={def.id} owner="white" className={styles.piece} />}
          {!isOrigin && kind === 'quiet' && <span className={styles.dot} />}
          {!isOrigin && kind === 'capture' && <span className={styles.ring} />}
          {!isOrigin && kind === 'both' && <span className={styles.ring} />}
        </div>,
      );
    }
  }

  return (
    <div className={styles.wrap}>
      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `repeat(${SIZE}, 24px)`,
          gridTemplateRows: `repeat(${SIZE}, 24px)`,
        }}
        aria-label={`Схема ходов: ${def.name}`}
      >
        {rows}
      </div>
      <div className={styles.legend}>
        <span>
          <i className={styles.legendQuiet} /> ход
        </span>
        <span>
          <i className={styles.legendCapture} /> удар
        </span>
      </div>
    </div>
  );
}
