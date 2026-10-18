// BlastSimulator2026 — Ramp steepness against vehicle tier climb limits (#1938)

import type { NavGrid } from '../nav/NavGrid.js';
import { NEIGHBOUR_OFFSETS_8 } from '../nav/NeighbourOffsets.js';
import { tiersThatClimb } from '../nav/ClimbLimit.js';
import type { BuiltRamp, GameState } from '../state/GameState.js';
import type { VehicleTier } from '../entities/Vehicle.js';

/** Float slack when comparing a measured grade against a tier limit. */
const GRADE_EPSILON_DEGREES = 1e-6;

const ALL_TIERS: readonly VehicleTier[] = [1, 2, 3];

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
        const grade = Math.atan(Math.abs(ny - y) / Math.hypot(dx, dz)) * 180 / Math.PI;
        if (grade > steepest) steepest = grade;
      }
    }
  }
  return steepest;
}

/** Steepest built ramp that exceeds `ratio`, or null when none blocks. */
export function steepestBlockingRamp(state: GameState, ratio: number): BuiltRamp | null {
  const navGrid = state.navGrid;
  if (navGrid === null) return null;
  const limitDeg = Math.atan(ratio) * 180 / Math.PI + GRADE_EPSILON_DEGREES;
  let worst: BuiltRamp | null = null;
  let worstGrade = limitDeg;
  for (const ramp of state.builtRamps) {
    const grade = rampSteepestGradeDegrees(navGrid, ramp);
    if (grade > worstGrade) {
      worstGrade = grade;
      worst = ramp;
    }
  }
  return worst;
}

/** Grade and the vehicle tiers that can climb the ramp; every tier climbs it off a progression site. */
export function describeRampClimb(
  navGrid: NavGrid, ramp: BuiltRamp, progression: boolean,
): { gradeDeg: number; tiers: VehicleTier[] } {
  const gradeDeg = rampSteepestGradeDegrees(navGrid, ramp);
  return { gradeDeg, tiers: progression ? tiersThatClimb(gradeDeg) : [...ALL_TIERS] };
}
