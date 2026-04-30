// BlastSimulator2026 — Task duration computation for employee skill proficiency.

import { PROFICIENCY_MULTIPLIERS } from '../config/balance.js';

/**
 * Compute the number of ticks needed to complete a task.
 *
 * Formula:
 *   ticksRequired = ceil(
 *     baseDuration
 *     * PROFICIENCY_MULTIPLIERS[proficiencyLevel]
 *     / (needMultiplier * lqMultiplier * eventMultiplier)
 *   )
 *
 * - proficiencyLevel: 1–5 (1 = Rookie baseline ×1.00, 5 = Master ×0.40)
 * - needMultiplier: productivity factor from needs (getNeedMultiplier()), e.g. 0.80 for hungry
 * - lqMultiplier: productivity factor from living quarters tier (0.85–1.10), e.g. 1.0 for no bonus
 * - eventMultiplier: combined event productivity factor (e.g. 1.20 for union happy hour)
 * - Result is always at least 1 tick
 * - baseDuration must be a positive integer
 */
export function computeTaskDuration(
  baseDuration: number,
  proficiencyLevel: 1 | 2 | 3 | 4 | 5,
  needMultiplier: number,
  lqMultiplier: number,
  eventMultiplier: number,
): number {
  const productivityMultiplier = needMultiplier * lqMultiplier * eventMultiplier;
  return Math.max(1, Math.ceil(
    (baseDuration * PROFICIENCY_MULTIPLIERS[proficiencyLevel]) / productivityMultiplier,
  ));
}
