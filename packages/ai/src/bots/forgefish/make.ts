import {
  applyCommand,
  applyKnownMove,
  type LegalMove,
  type MatchState,
} from '@chessforge/engine';
import type { Candidate } from './ordering.js';

export type AppliedClone = {
  ok: true;
  mode: 'clone';
  state: MatchState;
};

export type AppliedFail = { ok: false };

export type Applied = AppliedClone | AppliedFail;

/**
 * Single clone via engine applyKnownMove / applyCommand.
 *
 * NOTE: engine searchMakeMove currently double-copies the full state (snap + remap),
 * which is slower than one applyKnownMove. Until incremental undo lands in engine,
 * Forgefish uses the clone path for NPS.
 */
export function applyCandidate(state: MatchState, candidate: Candidate): Applied {
  if (candidate.command.type === 'endTurn') {
    const applied = applyCommand(state, { type: 'endTurn' });
    if (!applied.ok) return { ok: false };
    return { ok: true, mode: 'clone', state: applied.state };
  }
  const move = candidate.move;
  if (!move) return { ok: false };
  const applied = applyKnownMove(state, move);
  if (!applied.ok) return { ok: false };
  return { ok: true, mode: 'clone', state: applied.state };
}

export function applyCandidateRoot(
  state: MatchState,
  candidate: Candidate,
): { ok: true; state: MatchState } | { ok: false } {
  const applied = applyCandidate(state, candidate);
  if (!applied.ok) return { ok: false };
  return { ok: true, state: applied.state };
}

export function canMakeInPlace(move: LegalMove): boolean {
  return !move.abilityId && !move.push && !move.castle;
}
