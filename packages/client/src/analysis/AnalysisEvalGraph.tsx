import { useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { formatEvalCp } from '../battle/analyzeGame';
import type { AnalysisPath } from './analysisTree';
import { pathEquals } from './analysisTree';
import styles from './AnalysisEvalGraph.module.css';

export type EvalGraphPoint = {
  path: AnalysisPath;
  scoreWhite: number | null;
};

const W = 320;
const H = 64;
const PAD_X = 4;
const PAD_Y = 5;
const CAP_CP = 800;

function clampCp(score: number): number {
  if (Math.abs(score) >= 500_000) return score > 0 ? CAP_CP : -CAP_CP;
  return Math.max(-CAP_CP, Math.min(CAP_CP, score));
}

function xAt(i: number, n: number): number {
  if (n <= 1) return W / 2;
  return PAD_X + (i / (n - 1)) * (W - PAD_X * 2);
}

function yAt(cp: number): number {
  const mid = H / 2;
  return mid - (cp / CAP_CP) * (mid - PAD_Y);
}

/** Consecutive known scores as separate polylines — never invent values for gaps. */
function lineSegments(cps: Array<number | null>): string[] {
  const segs: string[] = [];
  let buf: string[] = [];
  for (let i = 0; i < cps.length; i += 1) {
    const cp = cps[i];
    if (cp == null) {
      if (buf.length >= 2) segs.push(buf.join(' '));
      buf = [];
      continue;
    }
    buf.push(`${xAt(i, cps.length)},${yAt(cp)}`);
  }
  if (buf.length >= 2) segs.push(buf.join(' '));
  return segs;
}

function areaSegments(cps: Array<number | null>, mid: number): string[] {
  const segs: string[] = [];
  let start = -1;
  for (let i = 0; i <= cps.length; i += 1) {
    const known = i < cps.length && cps[i] !== null;
    if (known && start < 0) start = i;
    if ((!known || i === cps.length) && start >= 0) {
      const end = known ? i : i - 1;
      if (end > start) {
        const pts = [
          `${xAt(start, cps.length)},${mid}`,
          ...Array.from({ length: end - start + 1 }, (_, k) => {
            const idx = start + k;
            return `${xAt(idx, cps.length)},${yAt(cps[idx]!)}`;
          }),
          `${xAt(end, cps.length)},${mid}`,
        ];
        segs.push(pts.join(' '));
      }
      start = -1;
    }
  }
  return segs;
}

type Props = {
  points: EvalGraphPoint[];
  cursorPath: AnalysisPath;
  onSelect: (path: AnalysisPath) => void;
  flipped?: boolean;
};

export function AnalysisEvalGraph({ points, cursorPath, onSelect, flipped = false }: Props) {
  const model = useMemo(() => {
    if (points.length === 0) return null;
    const cps = points.map((p) => {
      if (p.scoreWhite === null) return null;
      const v = clampCp(p.scoreWhite);
      return flipped ? -v : v;
    });
    const mid = H / 2;
    const lineSegs = lineSegments(cps);
    const areaSegs = areaSegments(cps, mid);
    let cursor = 0;
    let bestLen = -1;
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i]!.path;
      const isMatch =
        pathEquals(p, cursorPath) ||
        (p.length <= cursorPath.length && p.every((v, j) => cursorPath[j] === v));
      if (isMatch && p.length >= bestLen) {
        bestLen = p.length;
        cursor = i;
      }
    }
    return { cps, lineSegs, areaSegs, cursor, mid };
  }, [points, cursorPath, flipped]);

  if (!model || points.length === 0) return null;

  const known = points.filter((p) => p.scoreWhite !== null).length;
  const title =
    known > 0
      ? `Оценка по партии (${known}/${points.length})`
      : 'Оценка появится по мере анализа ходов';

  const onClickSvg = (ev: ReactMouseEvent<SVGSVGElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const d = Math.abs(xAt(i, points.length) - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    onSelect(points[best]!.path);
  };

  const cursorX = xAt(model.cursor, points.length);
  const cursorScore = points[model.cursor]?.scoreWhite ?? null;
  const label =
    cursorScore === null
      ? '…'
      : formatEvalCp(flipped ? -cursorScore : cursorScore);

  return (
    <div className={styles.wrap} title={title}>
      <div className={styles.head}>
        <span className={styles.headTitle}>Преимущество</span>
        <span className={styles.headScore}>{label}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.svg}
        role="img"
        aria-label={title}
        onClick={onClickSvg}
      >
        <defs>
          <linearGradient id="evalFillWhite" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(243, 239, 228, 0.55)" />
            <stop offset="100%" stopColor="rgba(243, 239, 228, 0.08)" />
          </linearGradient>
          <linearGradient id="evalFillBlack" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="rgba(26, 24, 22, 0.7)" />
            <stop offset="100%" stopColor="rgba(26, 24, 22, 0.15)" />
          </linearGradient>
        </defs>
        {model.areaSegs.map((pts, i) => (
          <polygon key={`a${i}`} points={pts} className={styles.area} />
        ))}
        <line
          x1={PAD_X}
          y1={model.mid}
          x2={W - PAD_X}
          y2={model.mid}
          className={styles.zero}
        />
        {model.lineSegs.map((pts, i) => (
          <polyline key={`l${i}`} points={pts} className={styles.line} fill="none" />
        ))}
        <line
          x1={cursorX}
          y1={PAD_Y}
          x2={cursorX}
          y2={H - PAD_Y}
          className={styles.cursor}
        />
        {model.cps.map((cp, i) =>
          cp === null ? (
            <circle
              key={i}
              cx={xAt(i, points.length)}
              cy={model.mid}
              r={i === model.cursor ? 3.4 : 1.4}
              className={i === model.cursor ? styles.pointActive : styles.pointMuted}
            />
          ) : (
            <circle
              key={i}
              cx={xAt(i, points.length)}
              cy={yAt(cp)}
              r={i === model.cursor ? 3.4 : 2.2}
              className={i === model.cursor ? styles.pointActive : styles.point}
            />
          ),
        )}
      </svg>
    </div>
  );
}
