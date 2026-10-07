// BlastSimulator2026 — Construction duration (#556). Pure.

import type { BuildingTier } from './Building.js';
import { BUILDING_CONSTRUCTION_BASE_DURATION_TICKS, BUILDING_CONSTRUCTION_TIER_MULTIPLIER } from '../config/balance.js';

/** Base ticks to construct a building of the given tier (before proficiency scaling). */
export function computeConstructionDurationTicks(tier: BuildingTier): number {
  return Math.ceil(BUILDING_CONSTRUCTION_BASE_DURATION_TICKS * BUILDING_CONSTRUCTION_TIER_MULTIPLIER[tier]);
}
