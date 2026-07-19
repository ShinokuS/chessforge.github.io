import {
  getLegalMoves,
  getPieceDefinition,
  type GameCommand,
  type MatchState,
} from '@chessforge/engine';

/** Higher is better for the side about to move. */
function scoreMove(state: MatchState, command: Extract<GameCommand, { type: 'move' }>): number {
  const moves = getLegalMoves(state, command.from);
  const legal = moves.find((m) => m.to.x === command.to.x && m.to.y === command.to.y);
  if (!legal) return -Infinity;

  let score = 0;
  if (legal.captures && legal.targetPieceId) {
    const target = state.pieces.find((p) => p.id === legal.targetPieceId);
    if (target) {
      const def = getPieceDefinition(target.defId);
      score += 10 + def.cost * 2 + (target.defId === 'king' ? 1000 : 0);
    }
  }
  // Prefer centralizing slightly
  const cx = (state.board.width - 1) / 2;
  const cy = (state.board.height - 1) / 2;
  const dist = Math.abs(command.to.x - cx) + Math.abs(command.to.y - cy);
  score += Math.max(0, 6 - dist) * 0.1;
  return score;
}

/**
 * Greedy heuristic: pick the highest-scoring legal move for the active player.
 * Falls back to endTurn if somehow no moves exist.
 */
export function chooseCommand(state: MatchState): GameCommand {
  const legal = getLegalMoves(state);
  if (legal.length === 0) {
    return { type: 'endTurn' };
  }

  let best: GameCommand = {
    type: 'move',
    from: { ...legal[0]!.from },
    to: { ...legal[0]!.to },
  };
  let bestScore = -Infinity;

  for (const m of legal) {
    const cmd: GameCommand = { type: 'move', from: { ...m.from }, to: { ...m.to } };
    const s = scoreMove(state, cmd);
    if (s > bestScore) {
      bestScore = s;
      best = cmd;
    }
  }
  return best;
}
