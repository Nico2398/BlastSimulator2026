// BlastSimulator2026 — Living Quarters well-being effects
// Computes productivity multipliers from active Living Quarters by tier.

import type { BuildingState, BuildingTier } from './Building.js';
import { getBuildingDef } from './Building.js';
import {
  LIVING_QUARTERS_WELLBEING_MULTIPLIERS,
  LIVING_QUARTERS_OVERCAPACITY_PENALTY,
} from '../config/balance.js';

/**
 * Productivity well-being multiplier derived from the best active Living Quarters tier.
 *
 * | Situation                    | Multiplier |
 * |------------------------------|-----------|
 * | No active living quarters    | 0.85      |
 * | Tier 1 ("The Cells")         | 0.90      |
 * | Tier 2 ("Staff Dormitory")   | 1.00      |
 * | Tier 3 ("Luxury Hotel")      | 1.10      |
 * | Any tier + overcapacity      | −0.10 on top |
 *
 * Overcapacity = employeeCount > total beds across all active living quarters.
 */
export function getLivingQuartersWellbeingMultiplier(
  state: BuildingState,
  employeeCount: number,
): number {
  const lqs = state.buildings.filter(b => b.active && b.type === 'living_quarters');

  if (lqs.length === 0) {
    return LIVING_QUARTERS_WELLBEING_MULTIPLIERS.absent;
  }

  let totalBeds = 0;
  let bestTier: BuildingTier = 1;
  for (const lq of lqs) {
    const def = getBuildingDef(lq.type, lq.tier);
    totalBeds += def.capacity;
    if (lq.tier > bestTier) bestTier = lq.tier as BuildingTier;
  }

  const key = `t${bestTier}` as keyof typeof LIVING_QUARTERS_WELLBEING_MULTIPLIERS;
  let multiplier: number = LIVING_QUARTERS_WELLBEING_MULTIPLIERS[key];

  if (employeeCount > totalBeds) {
    multiplier -= LIVING_QUARTERS_OVERCAPACITY_PENALTY;
  }

  return multiplier;
}
