// BlastSimulator2026 — Ramp steepness against vehicle tier climb limits (#1938)

import type { NavGrid } from '../nav/NavGrid.js';
import type { BuiltRamp, GameState } from '../state/GameState.js';
import type { VehicleTier } from '../entities/Vehicle.js';

/** Steepest step grade (degrees) along the ramp's built surface. */
export function rampSteepestGradeDegrees(navGrid: NavGrid, ramp: BuiltRamp): number {
  void navGrid; void ramp;
  return 0; // TODO: implement
}

/** Steepest built ramp that exceeds `ratio`, or null when none blocks. */
export function steepestBlockingRamp(state: GameState, ratio: number): BuiltRamp | null {
  void state; void ratio;
  return null; // TODO: implement
}

/** Grade and the vehicle tiers that can climb the ramp. */
export function describeRampClimb(
  navGrid: NavGrid, ramp: BuiltRamp, progression: boolean,
): { gradeDeg: number; tiers: VehicleTier[] } {
  void navGrid; void ramp; void progression;
  return { gradeDeg: 0, tiers: [] }; // TODO: implement
}
