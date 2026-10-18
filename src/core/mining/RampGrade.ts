// BlastSimulator2026 — Ramp steepness against vehicle tier climb limits (#1938)

import type { NavGrid } from '../nav/NavGrid.js';
import { NEIGHBOUR_OFFSETS_8 } from '../nav/NeighbourOffsets.js';
import { GRADE_EPSILON_DEGREES, VEHICLE_TIER_LIST, slopeDegreesForRatio, tiersThatClimb } from '../nav/ClimbLimit.js';
import type { BuiltRamp, GameState } from '../state/GameState.js';
import type { VehicleTier } from '../entities/Vehicle.js';

/** Steepest step grade (degrees) along the ramp's built surface. */
export function rampSteepestGradeDegrees(navGrid: NavGrid, ramp: BuiltRamp): number {
  const { minX, maxX, minZ, maxZ } = ramp.footprint;
  let steepest = 0;
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const y = navGrid.cellAt(x, z)?.surfaceY;
      if (y === undefined) continue;
      for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
        const ny = navGrid.cellAt(nx, nz)?.surfaceY;
        if (ny === undefined) continue;
        const grade = slopeDegreesForRatio(Math.abs(ny - y) / Math.hypot(dx, dz));
        if (grade > steepest) steepest = grade;
      }
    }
  }
  return steepest;
}

/** Steepest built ramp that exceeds `ratio`, with its grade; null when none blocks. */
export function steepestBlockingRamp(
  state: GameState, ratio: number,
): { ramp: BuiltRamp; gradeDeg: number } | null {
  const navGrid = state.navGrid;
  if (navGrid === null) return null;
  let worst: { ramp: BuiltRamp; gradeDeg: number } | null = null;
  let worstGrade = slopeDegreesForRatio(ratio) + GRADE_EPSILON_DEGREES;
  for (const ramp of state.builtRamps) {
    const gradeDeg = rampSteepestGradeDegrees(navGrid, ramp);
    if (gradeDeg > worstGrade) {
      worstGrade = gradeDeg;
      worst = { ramp, gradeDeg };
    }
  }
  return worst;
}

/** Grade and the vehicle tiers that can climb the ramp; every tier climbs it off a progression site. */
export function describeRampClimb(
  navGrid: NavGrid, ramp: BuiltRamp, progression: boolean,
): { gradeDeg: number; tiers: VehicleTier[] } {
  const gradeDeg = rampSteepestGradeDegrees(navGrid, ramp);
  return { gradeDeg, tiers: progression ? tiersThatClimb(gradeDeg) : [...VEHICLE_TIER_LIST] };
}
