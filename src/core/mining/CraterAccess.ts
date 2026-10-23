// BlastSimulator2026 — Crater access planning (#2082)
// Pure planner: finds floors stranded below the existing ramp network and proposes a ramp down to them.
// Reads terrain only through the narrow AccessSurface seam; no GameState.

import type { RampWidth } from '../config/balance.js';
import type { RampDef } from './Ramp.js';
import type { SpiralSurface } from './RampSpiral.js';

/** A cluster of unreachable order targets sharing one deepened floor. */
export interface StrandedFloor {
  x: number;
  z: number;
  floorY: number;
  orderCount: number;
}

/** Terrain seam: spiral surface plus a reachability query against the current vehicle network. */
export interface AccessSurface extends SpiralSurface {
  reachableFrom(x: number, z: number): boolean;
}

export type CraterAccessPlan =
  | { ok: true; def: RampDef; cost: number; gradeDegrees: number }
  | { ok: false; reasonKey: string };

/** Groups stranded cells whose spacing is within `gapCells` into floors. */
export function clusterStrandedFloors(
  _cells: ReadonlyArray<{ x: number; z: number; y: number }>,
  _gapCells: number,
): StrandedFloor[] {
  // TODO: implement
  return [];
}

/** Plans a ramp from the reachable network down to `floor`, within `maxClimbRatio`. */
export function planCraterAccess(
  _floor: StrandedFloor,
  _surface: AccessSurface,
  _maxClimbRatio: number,
  _width: RampWidth,
): CraterAccessPlan {
  // TODO: implement
  return { ok: false, reasonKey: '' };
}
