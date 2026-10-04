// BlastSimulator2026 — Why the workers revolted (drives the defeat tip shown to the player)

import type { ShiftMode } from '../entities/SitePolicy.js';

export type RevoltCause = 'no_rest_policy' | 'no_housing' | 'morale_drain';

/**
 * Classify the root cause of a worker revolt.
 * Planned rules: continuous/custom shift mode -> no_rest_policy;
 * else no active living quarters -> no_housing; else morale_drain.
 */
export function revoltCause(_shiftMode: ShiftMode, _hasActiveHousing: boolean): RevoltCause {
  // TODO: implement
  return 'morale_drain';
}
