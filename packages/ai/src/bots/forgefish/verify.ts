import type { MatchState } from '@chessforge/engine';
import { INF } from '../../search/model.js';
import type { Candidate } from './ordering.js';
import { hpSee } from './hpSee.js';

/**
 * Forced tactical set for verification searches (royal hits, strong SEE, deferred endTurn).
 */
export function forcedTacticalSet(
  state: MatchState,
  ordered: Candidate[],
  limit = 8,
): Candidate[] {
  const out: Candidate[] = [];
  for (const c of ordered) {
    if (out.length >= limit) break;
    if (!c.move) {
      if (c.key === 'endTurn' && c.tactical) out.push(c);
      continue;
    }
    if (c.move.captures || c.move.push) {
      const see = hpSee(state, c.move);
      if (see >= 80 || see >= 40_000) out.push(c);
      continue;
    }
    if (c.move.abilityId && hpSee(state, c.move) >= 150) out.push(c);
  }
  return out;
}

/**
 * Shallow re-search of forced moves when a fail-high looks suspicious.
 * Returns a corrected score or null if verification agrees / not needed.
 */
export function shouldVerify(
  isPv: boolean,
  depth: number,
  value: number,
  beta: number,
  verified: boolean,
): boolean {
  if (verified || isPv) return false;
  if (depth < 4) return false;
  if (value < beta) return false;
  if (Math.abs(value) >= INF - 10_000) return false;
  return true;
}
