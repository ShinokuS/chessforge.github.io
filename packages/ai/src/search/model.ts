import type { GameCommand, LegalMove, MatchState, PlayerId } from '@chessforge/engine';

export const INF = 1_500_000;
export const MATE = 1_000_000;

export type StopReason =
  | 'depth'
  | 'softTime'
  | 'hardTime'
  | 'nodes'
  | 'terminal'
  | 'fallback';

export type SearchOptions = {
  depth?: number;
  maxDepth?: number;
  timeMs?: number;
  nodeLimit?: number;
  skill?: number;
  ttBits?: number;
  /** Browser root workers; consumed by the client worker pool. */
  workers?: number;
  /** Approximate local transposition-table memory cap per worker. */
  memoryMb?: number;
  batch?: boolean;
  engine?: 'stockfish' | 'legacy';
  /**
   * Slightly leaner LMR only. Does not change root width or invent depth —
   * timed searches still report only completed ID iterations.
   */
  fastAnalysis?: boolean;
  /** Skip subsumed ID iterations (live resume from cached depth). */
  startDepth?: number;
  /** Live only: soft ms budget per ID step (fast depth ramp). */
  depthSliceMs?: number;
};

export type FullSearchResult = {
  best: GameCommand;
  score: number;
  scoreWhite: number;
  pv: GameCommand[];
  depth: number;
  selDepth: number;
  nodes: number;
  nps: number;
  elapsedMs: number;
  stoppedBy: StopReason;
};

export type ResolvedOptions = {
  maxDepth: number;
  softTimeMs: number;
  hardTimeMs: number;
  nodeLimit: number;
  skill: number;
  ttBits: number;
  batch: boolean;
  fastAnalysis: boolean;
  startDepth: number;
  depthSliceMs: number;
};

export function resolveOptions(options: SearchOptions, fullStrength = false): ResolvedOptions {
  const skill = fullStrength ? 10 : Math.max(0, Math.min(10, options.skill ?? 10));
  const strength = fullStrength || skill >= 10 ? 1 : 0.2 + skill * 0.08;
  const unlimited = (options.timeMs ?? 400) <= 0;
  const requestedTime = unlimited
    ? Number.MAX_SAFE_INTEGER
    : Math.max(1, options.timeMs ?? 400);
  const requestedNodes = Math.max(1, options.nodeLimit ?? 2_000_000);
  const memoryBits = options.memoryMb === undefined
    ? 20
    : Math.floor(Math.log2(Math.max(1, options.memoryMb) * 1024 * 1024 / 64));
  const fastAnalysis = options.fastAnalysis === true;
  return {
    maxDepth: Math.max(1, Math.min(24, options.maxDepth ?? options.depth ?? 4)),
    softTimeMs: unlimited
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, Math.floor(requestedTime * strength)),
    hardTimeMs: unlimited
      ? Number.MAX_SAFE_INTEGER
      : Math.max(
          Math.floor(requestedTime * strength * 1.12),
          Math.floor(requestedTime * strength) + 150,
        ),
    nodeLimit: Math.max(1, Math.floor(requestedNodes * strength)),
    skill,
    // Fast game analysis: still keep a useful TT (noise from tiny tables hurt scores).
    ttBits: Math.max(
      12,
      Math.min(20, memoryBits, options.ttBits ?? (fastAnalysis ? 17 : 18)),
    ),
    batch: options.batch === true,
    fastAnalysis,
    startDepth: Math.max(1, Math.floor(options.startDepth ?? 1)),
    depthSliceMs: Math.max(0, Math.floor(options.depthSliceMs ?? 0)),
  };
}

/** Per-ID ms budget: shallow steps are shorter, final depths get more time. */
export function depthSliceBudget(depth: number, maxDepth: number, baseMs: number): number {
  if (baseMs <= 0) return 0;
  if (depth <= 4) return Math.max(50, Math.floor(baseMs * 0.55));
  if (depth <= 8) return Math.max(70, Math.floor(baseMs * 0.8));
  if (depth >= maxDepth - 1) return Math.floor(baseMs * 1.4);
  if (depth >= maxDepth - 3) return Math.floor(baseMs * 1.15);
  return baseMs;
}

export function moveKey(move: LegalMove): string {
  return `${move.from.x},${move.from.y}->${move.to.x},${move.to.y}:${move.abilityId ?? ''}:${move.captures ? 1 : 0}:${move.push ? 1 : 0}`;
}

export function commandKey(command: GameCommand): string {
  return command.type === 'endTurn'
    ? 'endTurn'
    : `${command.from.x},${command.from.y}->${command.to.x},${command.to.y}:${command.abilityId ?? ''}:0:${command.push ? 1 : 0}`;
}

export function moveToCommand(move: LegalMove): GameCommand {
  return {
    type: 'move',
    from: { ...move.from },
    to: { ...move.to },
    ...(move.abilityId !== undefined ? { abilityId: move.abilityId } : {}),
    ...(move.push ? { push: true } : {}),
  };
}

export function rootNoise(command: GameCommand, skill: number, depth: number): number {
  const weakness = 10 - skill;
  if (weakness <= 0) return 0;
  const text = commandKey(command);
  let hash = depth * 97;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  const unit = ((hash >>> 0) % 2001) / 1000 - 1;
  return unit * (weakness * weakness * 18 + weakness * 40);
}

export function terminalScore(state: MatchState): number | null {
  if (state.phase !== 'gameOver') return null;
  if (!state.winner) return 0;
  return state.winner === state.activePlayer ? MATE : -MATE;
}

export function parentScore(
  parent: PlayerId,
  child: MatchState,
  childScore: number,
): number {
  return child.activePlayer === parent ? childScore : -childScore;
}

export function scoreWhite(state: MatchState, score: number): number {
  return state.activePlayer === 'white' ? score : -score;
}
