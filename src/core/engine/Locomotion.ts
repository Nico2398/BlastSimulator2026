// BlastSimulator2026 — Locomotion (#1089)
// The only mover: walks every alive employee's current itinerary leg (or, for
// an employee with no itinerary, the legacy destinationX/Z single foot leg)
// one tick's worth of movement, and — for a mounted employee — writes their
// vehicle's x/z from theirs. Replaces tickVehicle + tickEmployeeMovement
// (EntityMovementTick.ts), which stay in place until the implementer phase
// swaps every call site over.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { Vehicle } from '../entities/Vehicle.js';

/** Per-tick report, mirrors the old EmployeeMovementResult shape TickPipeline/console already consume. */
export interface LocomotionResult {
  moved: number[];
  arrived: number[];
  stuck: number[];
  abandoned: Array<{ employeeId: number; actionId: number | null }>;
}

/**
 * The only mover. Walks every alive employee's current itinerary leg (or, for
 * an employee with no itinerary, the legacy destinationX/Z single foot leg)
 * one tick's worth of movement, and — for a mounted employee — writes their
 * vehicle's x/z from theirs. The only place a vehicle's position ever changes.
 */
export function tickLocomotion(_state: GameState, _emitter?: EventEmitter): LocomotionResult {
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Advance a single already-boarded vehicle's driver toward (targetX, targetZ)
 * by one tick, independent of any itinerary — used by HaulingTask.ts's
 * to_depot phase and FragmentTaskLifecycle.ts's driveTowardFragment for their
 * own ad hoc phase-driving. Writes vehicle.x/z from the driver's own advance.
 * No-op (returns arrived:false) when the vehicle has no occupant.
 */
export function driveVehicleTowardTarget(
  _state: GameState,
  _vehicle: Vehicle,
  _targetX: number,
  _targetZ: number,
  _emitter?: EventEmitter,
): { arrived: boolean } {
  // TODO: implement
  throw new Error('not implemented');
}
