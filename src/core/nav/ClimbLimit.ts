// BlastSimulator2026 — Per-vehicle-tier climb limits (#1938)

import { VEHICLE_TIER_MAX_SLOPE_DEGREES } from '../config/balance.js';
import type { VehicleTier } from '../entities/Vehicle.js';

/** Float slack so a grade exactly at a tier's limit counts as climbable (matches isStepClimbable's epsilon spirit). */
const GRADE_EPSILON_DEGREES = 1e-6;

const TIERS: readonly VehicleTier[] = [1, 2, 3];

/** tan of a slope in degrees. */
export function slopeRatioForDegrees(deg: number): number {
  return Math.tan(deg * Math.PI / 180);
}

/** Steepest climbable slope (degrees) for a tier. */
export function slopeDegreesForTier(tier: VehicleTier): number {
  return VEHICLE_TIER_MAX_SLOPE_DEGREES[tier];
}

/** Steepest climbable rise/run for a tier. */
export function tierSlopeRatio(tier: VehicleTier): number {
  return slopeRatioForDegrees(slopeDegreesForTier(tier));
}

/** Tiers able to climb a grade of `gradeDeg` degrees. */
export function tiersThatClimb(gradeDeg: number): VehicleTier[] {
  return TIERS.filter(tier => gradeDeg <= slopeDegreesForTier(tier) + GRADE_EPSILON_DEGREES);
}
