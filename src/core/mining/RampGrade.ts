// BlastSimulator2026 — Ramp steepness against vehicle tier climb limits (#1938)

import type { NavGrid } from '../nav/NavGrid.js';
import { NEIGHBOUR_OFFSETS_8 } from '../nav/NeighbourOffsets.js';
import { GRADE_EPSILON_DEGREES, VEHICLE_TIER_LIST, slopeDegreesForRatio, tiersThatClimb } from '../nav/ClimbLimit.js';
import { rampFootprintRects } from './RampPath.js';
import type { BuiltRamp, GameState, RampFootprint } from '../state/GameState.js';
import type { VehicleTier } from '../entities/Vehicle.js';

/** Corridor tiles of a ramp: its legs' rectangles (the L's empty corner excluded), else its footprint. */
function corridorRects(ramp: BuiltRamp): readonly RampFootprint[] {
  return ramp.def.legs
    ? rampFootprintRects({ originX: ramp.def.originX, originZ: ramp.def.originZ, legs: ramp.def.legs }, ramp.width)
    : [ramp.footprint];
}

/** Steepest step grade (degrees) along the ramp's built surface, between tiles of its own corridor. */
export function rampSteepestGradeDegrees(navGrid: NavGrid, ramp: BuiltRamp): number {
  const rects = corridorRects(ramp);
  const inCorridor = (x: number, z: number) => rects.some(r => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
  let steepest = 0;
  for (const { minX, maxX, minZ, maxZ } of rects) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const y = navGrid.cellAt(x, z)?.surfaceY;
        if (y === undefined) continue;
        for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
          const nx = x + dx;
          const nz = z + dz;
          if (!inCorridor(nx, nz)) continue;
          const ny = navGrid.cellAt(nx, nz)?.surfaceY;
          if (ny === undefined) continue;
          const grade = slopeDegreesForRatio(Math.abs(ny - y) / Math.hypot(dx, dz));
          if (grade > steepest) steepest = grade;
        }
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
