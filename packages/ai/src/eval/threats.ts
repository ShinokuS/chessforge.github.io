import {
  getLegalMoves,
  getPieceDefinition,
  isRoyalPiece,
  type MatchState,
  type PieceInstance,
  type PlayerId,
} from '@chessforge/engine';
import { ROLE_VALUE, featureModBonus } from '../heuristics.js';
import type { MoveSnapshot, SideValues } from './types.js';

function opposite(side: PlayerId): PlayerId {
  return side === 'white' ? 'black' : 'white';
}

function squareKey(x: number, y: number): string {
  return `${x},${y}`;
}

function tacticalValue(piece: PieceInstance): number {
  const def = getPieceDefinition(piece.defId);
  if (def.baseRole === 'king') return 900;
  return ROLE_VALUE[def.baseRole] + featureModBonus(def);
}

export function emptySideValues(): SideValues {
  return { white: 0, black: 0 };
}

type CaptureMaps = {
  captures: Map<string, number>;
  lethalCaptures: Map<string, number>;
  captureDamage: Map<string, number>;
  minAttackerValue: Map<string, number>;
};

/**
 * Credit capture threats with side-to-move priority (hanging / en prise).
 *
 * Classical engines mark material as lost when it can be taken *now*, not only
 * after it leaves the board. Stockfish relies on NNUE + quiescence for this;
 * we approximate with STM-weighted hangs so shallow analysis swings on the
 * blunder ply instead of waiting for the capture.
 */
export function accumulateCaptureThreats(
  state: MatchState,
  moves: Record<
    PlayerId,
    Pick<
      MoveSnapshot,
      'captures' | 'lethalCaptures' | 'captureDamage' | 'minAttackerValue'
    >
  >,
  threats: SideValues,
): void {
  const stm = state.activePlayer;
  for (const victim of state.pieces) {
    if (isRoyalPiece(victim)) continue;
    const attacker = opposite(victim.owner);
    const key = squareKey(victim.pos.x, victim.pos.y);
    if (!moves[attacker].captures.has(key)) continue;

    const lethal = moves[attacker].lethalCaptures.has(key);
    const value = tacticalValue(victim);
    const def = getPieceDefinition(victim.defId);
    const shield = (victim.shieldTurns ?? 0) > 0 ? 0.18 : 1;
    const stmCanTake = attacker === stm;
    const defended = moves[victim.owner].captures.has(key);

    const damage =
      moves[attacker].captureDamage.get(key) ??
      (lethal ? victim.hp : Math.min(victim.hp, 1));
    const hpFrac =
      victim.hp > 0 ? Math.min(1, Math.max(0.35, damage / Math.max(1, victim.hp))) : 1;
    const hangMaterial = lethal ? value : value * (0.45 + 0.55 * hpFrac);

    const minAtk = moves[attacker].minAttackerValue.get(key) ?? value;
    const seeWin = lethal && minAtk + 40 < value;

    let weight: number;
    if (stmCanTake) {
      // Side to move can take immediately — almost full piece (SEE / hanging).
      if (lethal) {
        weight = !defended || seeWin ? 1.0 : 0.88;
      } else {
        weight = !defended || seeWin ? 0.78 : 0.55;
      }
    } else if (lethal) {
      // Not STM: residual pressure only. Summing near-full non-STM hangs made
      // quiet "double attacks" outscore actually taking a free piece (Stockfish
      // relies on search here; static must not invent a free rook+knight).
      weight = !defended || seeWin ? 0.2 : 0.12;
    } else {
      weight = !defended || seeWin ? 0.12 : 0.08;
    }

    if (!lethal && def.maxHp > 1) {
      weight *= 0.92;
    }

    threats[attacker] += shield * hangMaterial * weight;
  }
}

/** Lightweight capture maps for one side (used by evaluateSearch). */
export function buildCaptureMaps(state: MatchState, side: PlayerId): CaptureMaps {
  const probe: MatchState = {
    ...state,
    activePlayer: side,
    extraMovePieceId:
      state.activePlayer === side ? (state.extraMovePieceId ?? null) : null,
  };
  const moves = getLegalMoves(probe);
  const captures = new Map<string, number>();
  const lethalCaptures = new Map<string, number>();
  const captureDamage = new Map<string, number>();
  const minAttackerValue = new Map<string, number>();
  const byId = new Map(state.pieces.map((p) => [p.id, p]));
  const bySq = new Map(state.pieces.map((p) => [squareKey(p.pos.x, p.pos.y), p]));

  for (const move of moves) {
    if (!move.captures || !move.targetPieceId) continue;
    const target = byId.get(move.targetPieceId);
    const value = target ? tacticalValue(target) : 100;
    const key = squareKey(move.to.x, move.to.y);
    captures.set(key, Math.max(captures.get(key) ?? 0, value));

    const mover = bySq.get(squareKey(move.from.x, move.from.y));
    if (!mover || !target) continue;
    const moverDef = getPieceDefinition(mover.defId);
    const moverValue = tacticalValue(mover);
    const prevMin = minAttackerValue.get(key);
    if (prevMin === undefined || moverValue < prevMin) {
      minAttackerValue.set(key, moverValue);
    }
    if (!moverDef.freezeInsteadOfCapture && moverDef.attack > 0) {
      captureDamage.set(key, Math.max(captureDamage.get(key) ?? 0, moverDef.attack));
    }
    if (
      !moverDef.freezeInsteadOfCapture &&
      moverDef.attack > 0 &&
      (target.shieldTurns ?? 0) === 0 &&
      target.hp - moverDef.attack <= 0
    ) {
      lethalCaptures.set(key, Math.max(lethalCaptures.get(key) ?? 0, tacticalValue(target)));
    }
  }

  return { captures, lethalCaptures, captureDamage, minAttackerValue };
}

/** White-minus-black style relative threat score from `perspective`. */
export function threatScoreForPerspective(
  state: MatchState,
  perspective: PlayerId,
): number {
  const threats = emptySideValues();
  const maps = {
    white: buildCaptureMaps(state, 'white'),
    black: buildCaptureMaps(state, 'black'),
  };
  accumulateCaptureThreats(state, maps, threats);
  const opponent = opposite(perspective);
  return threats[perspective] - threats[opponent];
}
