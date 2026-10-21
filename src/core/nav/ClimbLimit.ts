// BlastSimulator2026 — Per-vehicle-tier climb limits (#1938)

import { VEHICLE_TIER_MAX_SLOPE_DEGREES } from '../config/balance.js';
import type { VehicleTier } from '../entities/Vehicle.js';

/** Float slack so a grade exactly at a tier's limit counts as climbable (matches isStepClimbable's epsilon spirit). */
export const GRADE_EPSILON_DEGREES = 1e-6;

/** Every vehicle tier, lowest first. */
export const VEHICLE_TIER_LIST: readonly VehicleTier[] = [1, 2, 3];

/** tan of a slope in degrees. */
export function slopeRatioForDegrees(deg: number): number {
  return Math.tan(deg * Math.PI / 180);
}

/** Angle in degrees of a rise/run slope; inverse of `slopeRatioForDegrees`. */
export function slopeDegreesForRatio(ratio: number): number {
  return Math.atan(ratio) * 180 / Math.PI;
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
  return VEHICLE_TIER_LIST.filter(tier => gradeDeg <= slopeDegreesForTier(tier) + GRADE_EPSILON_DEGREES);
}

/** Steepest rise/run the least capable vehicle tier climbs: the grade every tier can leave a spawn on (#2044). */
export function slowestVehicleTierSlopeRatio(): number {
  return Math.min(...VEHICLE_TIER_LIST.map(tier => slopeRatioForDegrees(slopeDegreesForTier(tier))));
}
