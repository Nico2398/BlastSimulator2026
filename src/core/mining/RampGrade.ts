// BlastSimulator2026 — Ramp steepness against the vehicle climb limit (#1938, #2045)

import type { NavGrid } from '../nav/NavGrid.js';
import { NEIGHBOUR_OFFSETS_8 } from '../nav/NeighbourOffsets.js';
import { GRADE_EPSILON_DEGREES, slopeDegreesForRatio } from '../nav/ClimbLimit.js';
import { rampCenterline, rampPathOf, rampTotalLength } from './RampPath.js';
import type { BuiltRamp, GameState } from '../state/GameState.js';
import { vehicleMaxSlopeRatio } from '../entities/Vehicle.js';
import { rampGradeBoundsDegrees, type RampDef } from './Ramp.js';

/** Steepest grade (degrees) between consecutive tiles of a multi-leg ramp's centreline; the corner's inside and the bounding box's empty corner are not the path. */
function steepestAlongCenterline(navGrid: NavGrid, ramp: BuiltRamp): number {
  const line = rampCenterline(rampPathOf(ramp.def));
  let steepest = 0;
  for (let i = 1; i < line.length; i++) {
    const y = navGrid.cellAt(line[i - 1]!.x, line[i - 1]!.z)?.surfaceY;
    const ny = navGrid.cellAt(line[i]!.x, line[i]!.z)?.surfaceY;
    if (y === undefined || ny === undefined) continue;
    steepest = Math.max(steepest, slopeDegreesForRatio(Math.abs(ny - y)));
  }
  return steepest;
}

/** Steepest step grade (degrees) along the ramp's built surface: its whole footprint when straight, its centreline when it turns. */
export function rampSteepestGradeDegrees(navGrid: NavGrid, ramp: BuiltRamp): number {
  if (ramp.def.legs) return steepestAlongCenterline(navGrid, ramp);
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

/** One ramp's grade against the single vehicle slope limit (#2045). */
export type RampClimb = { gradeDeg: number; climbable: boolean; maxDeg: number };

/** A grade against the one vehicle slope limit (30° off a progression site). */
export function climbForGrade(gradeDeg: number, progression: boolean): RampClimb {
  const maxDeg = slopeDegreesForRatio(vehicleMaxSlopeRatio(progression));
  return { gradeDeg, climbable: gradeDeg <= maxDeg + GRADE_EPSILON_DEGREES, maxDeg };
}

/** A built ramp's steepest grade against the vehicle slope limit. */
export function describeRampClimbability(
  navGrid: NavGrid, ramp: BuiltRamp, progression: boolean,
): RampClimb {
  return climbForGrade(rampSteepestGradeDegrees(navGrid, ramp), progression);
}

/** Grade in degrees the order will be cut at: its chosen grade, else the straight line to `targetDepth`. */
export function plannedRampGradeDegrees(def: Pick<RampDef, 'length' | 'legs' | 'targetDepth' | 'gradeDegrees'>): number {
  if (def.gradeDegrees !== undefined) return def.gradeDegrees;
  const total = def.legs ? rampTotalLength(def.legs) : def.length;
  return rampGradeBoundsDegrees(total, def.targetDepth).min;
}
