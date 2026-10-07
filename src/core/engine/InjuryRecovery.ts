// InjuryRecovery — injured employees recover over time, faster in better living quarters (#1382).

import type { GameState } from '../state/GameState.js';

/** Recovery progress per tick for a living-quarters tier (null = none available). */
export function injuryRecoveryRate(lqTier: 1 | 2 | 3 | null): number {
  void lqTier;
  // TODO: implement
  return 0;
}

/** Advance recovery for every injured employee, healing those that finish. */
export function tickInjuryRecovery(state: GameState): void {
  void state;
  // TODO: implement
}
