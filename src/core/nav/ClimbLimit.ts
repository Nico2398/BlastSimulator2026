// BlastSimulator2026 — Per-vehicle-tier climb limits (#1938)

import type { VehicleTier } from '../entities/Vehicle.js';

/** tan of a slope in degrees. */
export function slopeRatioForDegrees(deg: number): number {
  void deg;
  return 0; // TODO: implement
}

/** Steepest climbable slope (degrees) for a tier. */
export function slopeDegreesForTier(tier: VehicleTier): number {
  void tier;
  return 0; // TODO: implement
}

/** Steepest climbable rise/run for a tier. */
export function tierSlopeRatio(tier: VehicleTier): number {
  void tier;
  return 0; // TODO: implement
}

/** Tiers able to climb a grade of `gradeDeg` degrees. */
export function tiersThatClimb(gradeDeg: number): VehicleTier[] {
  void gradeDeg;
  return []; // TODO: implement
}
