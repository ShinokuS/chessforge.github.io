import type { LegalMove, PlayerId } from '@chessforge/engine';

export type SideValues = Record<PlayerId, number>;

export type MoveSnapshot = {
  moves: ReadonlyArray<LegalMove>;
  captures: ReadonlyMap<string, number>;
  lethalCaptures: ReadonlyMap<string, number>;
  /** Best attack damage deliverable to the square. */
  captureDamage: ReadonlyMap<string, number>;
  /** Cheapest attacker that can capture on the square. */
  minAttackerValue: ReadonlyMap<string, number>;
  mobility: number;
};

export type EvaluationFeatures = {
  materialHp: SideValues;
  status: SideValues;
  tiles: SideValues;
  abilities: SideValues;
  pieceSquare: SideValues;
  threats: SideValues;
  royalSafety: SideValues;
};

export type EvaluationSnapshot = {
  phase: number;
  features: EvaluationFeatures;
  moves: Record<PlayerId, MoveSnapshot>;
  royalSquares: Record<PlayerId, ReadonlyArray<string>>;
};
