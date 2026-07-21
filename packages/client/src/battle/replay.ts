import { applyCommand, type Coord, type GameCommand, type MatchState } from '@chessforge/engine';

type LastMoveHighlight = {
  from: Coord;
  to: Coord;
};

/** Positions after each applied move command (index 0 = opening). */
export function buildReplayPositions(
  opening: MatchState,
  commands: GameCommand[],
): MatchState[] {
  const positions = [structuredClone(opening)];
  let state = structuredClone(opening);
  for (const cmd of commands) {
    const result = applyCommand(state, cmd);
    if (!result.ok) break;
    state = result.state;
    if (cmd.type === 'move') {
      positions.push(structuredClone(state));
    }
  }
  return positions;
}

export function lastMoveAtReplayIndex(
  commands: GameCommand[],
  index: number,
): LastMoveHighlight | null {
  if (index <= 0) return null;
  let moveIdx = 0;
  for (const cmd of commands) {
    if (cmd.type !== 'move') continue;
    moveIdx += 1;
    if (moveIdx === index) {
      return { from: cmd.from, to: cmd.to };
    }
  }
  return null;
}
