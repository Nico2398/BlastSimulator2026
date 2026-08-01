// BlastSimulator2026 — Hauling task
//
// Position-gated debris hauling: a debris_hauler vehicle is dispatched to a
// fragment, loads it only on arrival, then drives to a depot building and
// delivers it only on arrival. ArrivalGate.ts drives the phase transitions.

import type { GameState } from '../state/GameState.js';
import type { Vehicle } from '../entities/Vehicle.js';

/**
 * Request that a debris_hauler vehicle haul a fragment to the nearest active
 * depot/warehouse building. Sets the vehicle's hauling intent (fragmentId,
 * phase, destination depot) without moving or loading it immediately —
 * ArrivalGate.tickArrivalGate and tickHaulingProgress drive the phases.
 */
export function requestHaulFragment(
  _state: GameState,
  _vehicleId: number,
  _fragmentId: number,
): { success: boolean; error?: string } {
  throw new Error('not implemented: requestHaulFragment');
}

/**
 * Advance a single vehicle's in-progress hauling task by one tick: moves it
 * toward its current phase target, and on arrival transitions
 * 'to_fragment' -> load -> 'to_depot' -> deliver -> idle.
 */
export function tickHaulingProgress(_state: GameState, _vehicle: Vehicle): void {
  throw new Error('not implemented: tickHaulingProgress');
}
