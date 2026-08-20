// BlastSimulator2026 — XP-per-tick award rules for employee skill proficiency.

import { XP_PER_TICK_BASE, XP_PER_TICK_LEVEL_SCALE } from '../config/balance.js';

/**
 * Compute the XP awarded per tick for an employee working at the given
 * proficiency level.
 *
 * Formula: XP_PER_TICK_BASE + floor(proficiencyLevel * XP_PER_TICK_LEVEL_SCALE)
 */
export function computeXpPerTick(proficiencyLevel: 1 | 2 | 3 | 4 | 5): number {
  return XP_PER_TICK_BASE + Math.floor(proficiencyLevel * XP_PER_TICK_LEVEL_SCALE);
}
