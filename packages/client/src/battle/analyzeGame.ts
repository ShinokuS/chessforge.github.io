import type { ChooseOptions } from '@chessforge/ai';
import {
  applyCommand,
  getPieceDefinition,
  type GameCommand,
  type MatchState,
  type PlayerId,
} from '@chessforge/engine';
import { getAiPool } from '../ai/AiWorkerPool.js';
import {
  classifyByWinChance,
  judgmentLabel as judgmentLabelShared,
  type MoveJudgment,
} from '../analysis/moveJudgment.js';

export type { MoveJudgment };

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
  timeMs: 350,
  nodeLimit: 400_000,
  skill: 10,
  ttBits: 18,
  workers: 4,
  engine: 'stockfish',
};

export function judgmentLabel(j: MoveJudgment): string {
  return judgmentLabelShared(j);
}

function sq(x: number, y: number): string {
  return `${String.fromCharCode(97 + x)}${y + 1}`;
}

export function formatMoveCommand(state: MatchState, cmd: GameCommand): string {
  if (cmd.type === 'endTurn') return 'Закончить ход';
  const piece = state.pieces.find((p) => p.pos.x === cmd.from.x && p.pos.y === cmd.from.y);
  const name = piece ? getPieceDefinition(piece.defId).name : 'фигура';
  if (cmd.push) {
    return `Таран ${name} → ${sq(cmd.to.x, cmd.to.y)}`;
  }
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
      (a.abilityId ?? '') === (b.abilityId ?? '') &&
      Boolean(a.push) === Boolean(b.push)
    );
  }
  return JSON.stringify(a) === JSON.stringify(b);
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

  // Include endTurn so deferred extra-moves replay correctly; only score real moves.
  const scoredTotal = commands.filter((c) => c.type === 'move').length;
  let scoredDone = 0;

  for (const played of commands) {
    if (state.phase !== 'play') break;

    if (played.type === 'endTurn') {
      const after = applyCommand(state, played);
      if (!after.ok) break;
      state = after.state;
      // Do not push positions — keeps plies[i] aligned with positions[i + 1].
      continue;
    }

    if (played.type !== 'move') continue;

    const player = state.activePlayer;
    const playedLabel = formatMoveCommand(state, played);

    const root = await pool.searchPosition(state, options);
    const best = root.best;
    const bestLabel =
      best.type === 'move' || best.type === 'endTurn'
        ? formatMoveCommand(state, best)
        : formatMoveCommand(state, played);
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

    scoredDone += 1;
    plies.push({
      ply: scoredDone,
      player,
      played,
      best,
      evalBefore,
      evalAfter,
      evalBest,
      loss,
      judgment: classifyByWinChance(evalBefore, evalAfter, player, sameAsBest).judgment,
      playedLabel,
      bestLabel,
      sameAsBest,
    });

    state = afterPlayed.state;
    positions.push(structuredClone(state));
    onProgress?.({ done: scoredDone, total: scoredTotal });
  }

  return { plies, positions };
}

/** Format white-centric cp for display (e.g. +1.2, −0.4). */
export function formatEvalCp(cp: number): string {
  // Real search mates are ±1_000_000. Static king-threat penalties are ~75_000 —
  // those must NOT be shown as mate.
  if (Math.abs(cp) >= 500_000) return cp > 0 ? 'М#' : '−М#';
  const p = cp / 100;
  const sign = p > 0 ? '+' : '';
  return `${sign}${p.toFixed(1)}`;
}
