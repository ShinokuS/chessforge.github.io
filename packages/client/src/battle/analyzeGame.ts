import type { ChooseOptions } from '@chessforge/ai';
import {
  applyCommand,
  getPieceDefinition,
  type GameCommand,
  type MatchState,
  type PlayerId,
} from '@chessforge/engine';
import { getAiPool } from '../ai/AiWorkerPool.js';

export type MoveJudgment =
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

export type AnalyzedPly = {
  ply: number;
  player: PlayerId;
  played: GameCommand;
  best: GameCommand;
  /** White-centric search eval of the position before the move. */
  evalBefore: number;
  /** White-centric search eval after the played move. */
  evalAfter: number;
  /** White-centric search eval after the engine's best move. */
  evalBest: number;
  /** Centipawns lost vs best for the side that moved (search). */
  loss: number;
  judgment: MoveJudgment;
  playedLabel: string;
  bestLabel: string;
  sameAsBest: boolean;
};

export type AnalysisProgress = {
  done: number;
  total: number;
};

/**
 * Analysis uses real search in workers (not static eval).
 */
export const ANALYSIS_OPTIONS: ChooseOptions = {
  maxDepth: 8,
  timeMs: 600,
  nodeLimit: 220_000,
  skill: 10,
  ttBits: 17,
};

const JUDGMENT_RU: Record<MoveJudgment, string> = {
  best: 'Лучший',
  excellent: 'Отличный',
  good: 'Хороший',
  inaccuracy: 'Неточность',
  mistake: 'Ошибка',
  blunder: 'Зевок',
};

export function judgmentLabel(j: MoveJudgment): string {
  return JUDGMENT_RU[j];
}

function sq(x: number, y: number): string {
  return `${String.fromCharCode(97 + x)}${y + 1}`;
}

export function formatMoveCommand(state: MatchState, cmd: GameCommand): string {
  if (cmd.type !== 'move') return cmd.type;
  const piece = state.pieces.find((p) => p.pos.x === cmd.from.x && p.pos.y === cmd.from.y);
  const name = piece ? getPieceDefinition(piece.defId).name : 'фигура';
  const ability =
    cmd.abilityId === 'retreat'
      ? ' (отступление)'
      : cmd.abilityId === 'royalWarp'
        ? ' (телепорт)'
        : cmd.abilityId === 'allyLeap'
          ? ' (прыжок)'
          : cmd.abilityId === 'allySwap'
            ? ' (обмен)'
            : cmd.abilityId === 'blessHeal'
              ? ' (лечение)'
              : cmd.abilityId === 'abdicate'
                ? ' (титул)'
                : cmd.abilityId === 'grantShield'
                  ? ' (щит)'
                  : cmd.abilityId === 'designatePromote'
                    ? ' (назначение)'
                    : '';
  return `${name} ${sq(cmd.from.x, cmd.from.y)}→${sq(cmd.to.x, cmd.to.y)}${ability}`;
}

function commandsEqual(a: GameCommand, b: GameCommand): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'move' && b.type === 'move') {
    return (
      a.from.x === b.from.x &&
      a.from.y === b.from.y &&
      a.to.x === b.to.x &&
      a.to.y === b.to.y &&
      (a.abilityId ?? '') === (b.abilityId ?? '')
    );
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function classify(loss: number, sameAsBest: boolean): MoveJudgment {
  if (sameAsBest || loss <= 20) return 'best';
  if (loss <= 50) return 'excellent';
  if (loss <= 90) return 'good';
  if (loss <= 160) return 'inaccuracy';
  if (loss <= 300) return 'mistake';
  return 'blunder';
}

/**
 * Replay commands and score each ply with the search engine in workers.
 */
export async function analyzeGame(
  opening: MatchState,
  commands: GameCommand[],
  options: ChooseOptions = ANALYSIS_OPTIONS,
  onProgress?: (p: AnalysisProgress) => void,
): Promise<{ plies: AnalyzedPly[]; positions: MatchState[] }> {
  const pool = getAiPool();
  const plies: AnalyzedPly[] = [];
  const positions: MatchState[] = [structuredClone(opening)];
  let state = structuredClone(opening);
  const moveCmds = commands.filter((c) => c.type === 'move');

  for (let i = 0; i < moveCmds.length; i++) {
    const played = moveCmds[i]!;
    if (state.phase !== 'play') break;

    const player = state.activePlayer;
    const playedLabel = formatMoveCommand(state, played);

    const root = await pool.searchPosition(state, options);
    const best = root.best;
    const bestLabel =
      best.type === 'move' ? formatMoveCommand(state, best) : formatMoveCommand(state, played);
    const sameAsBest = commandsEqual(played, best);

    const bestScoreStm = root.score;
    const playedScoreStm = sameAsBest
      ? bestScoreStm
      : await pool.searchScoreCommand(state, played, options);
    const loss = Math.max(0, bestScoreStm - playedScoreStm);

    const afterPlayed = applyCommand(state, played);
    if (!afterPlayed.ok) break;

    const evalBefore = root.scoreWhite;
    const afterRoot = await pool.searchPosition(afterPlayed.state, options);
    const evalAfter = afterRoot.scoreWhite;
    const evalBest = sameAsBest
      ? evalAfter
      : await pool.searchScoreWhiteAfter(state, best, options);

    plies.push({
      ply: i + 1,
      player,
      played,
      best,
      evalBefore,
      evalAfter,
      evalBest,
      loss,
      judgment: classify(loss, sameAsBest),
      playedLabel,
      bestLabel,
      sameAsBest,
    });

    state = afterPlayed.state;
    positions.push(structuredClone(state));
    onProgress?.({ done: i + 1, total: moveCmds.length });
  }

  return { plies, positions };
}

/** Format white-centric cp for display (e.g. +1.2, −0.4). */
export function formatEvalCp(cp: number): string {
  if (Math.abs(cp) >= 50_000) return cp > 0 ? 'М#' : '−М#';
  const p = cp / 100;
  const sign = p > 0 ? '+' : '';
  return `${sign}${p.toFixed(1)}`;
}
