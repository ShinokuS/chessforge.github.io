import type { PlayerId } from '@chessforge/engine';
import type { EvaluationSnapshot, SideValues } from './types.js';

function tapered(opening: number, endgame: number, phase: number): number {
  return endgame + (opening - endgame) * phase;
}

function relative(values: SideValues, perspective: PlayerId): number {
  const opponent: PlayerId = perspective === 'white' ? 'black' : 'white';
  return values[perspective] - values[opponent];
}

export function scoreSnapshot(
  snapshot: EvaluationSnapshot,
  perspective: PlayerId,
): number {
  const { features, phase } = snapshot;
  const opponent: PlayerId = perspective === 'white' ? 'black' : 'white';
  const mobility =
    snapshot.moves[perspective].mobility - snapshot.moves[opponent].mobility;

  return (
    relative(features.materialHp, perspective) +
    relative(features.status, perspective) * tapered(0.82, 1.08, phase) +
    relative(features.tiles, perspective) * tapered(0.78, 0.98, phase) +
    relative(features.abilities, perspective) * tapered(1.05, 0.68, phase) +
    relative(features.pieceSquare, perspective) * tapered(1.25, 0.62, phase) +
    mobility * tapered(1.15, 0.72, phase) +
    relative(features.threats, perspective) * tapered(0.92, 1.14, phase) +
    relative(features.royalSafety, perspective) * tapered(0.96, 1.08, phase)
  );
}
