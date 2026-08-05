// BlastSimulator2026 — Boulder breaking task (stub, issue #484)
//
// Position-gated in-place breaking of an oversized fragment: a
// rock_fragmenter vehicle is dispatched to a boulder, breaks it only on
// arrival, replacing it in logistics with its sub-fragments. Mirrors
// HaulingTask.ts's shape (eligibility gate, request, per-tick progress,
// reachable-target lookup) for the break workflow instead of the haul one.
// ArrivalGate.ts drives the phase transitions.

import type { GameState } from '../state/GameState.js';
import type { Vehicle } from '../entities/Vehicle.js';

/**
 * True when `vehicle` is a rock_fragmenter with a driver assigned and no
 * break task already in progress — the shared eligibility gate for
 * findReachableOversizedFragment and the UI's Break button.
 */
export function isBreakEligibleVehicle(_vehicle: Vehicle | undefined): _vehicle is Vehicle {
  throw new Error('not implemented');
}

/**
 * Request that a rock_fragmenter vehicle break an oversized fragment in
 * place. Sets the vehicle's break intent (fragmentId, phase) without moving
 * or breaking it immediately — ArrivalGate.tickArrivalGate and
 * tickBreakProgress drive the phases.
 */
export function requestBreakBoulder(
  _state: GameState,
  _vehicleId: number,
  _fragmentId: number,
): { success: boolean; error?: string } {
  throw new Error('not implemented');
}

/** Returns the id of the fragment split this tick, or null (still travelling / aborted / no-op). */
export function tickBreakProgress(_state: GameState, _vehicle: Vehicle): number | null {
  throw new Error('not implemented');
}

/**
 * Find a reachability-aware oversized fragment for `vehicleId` to break: the
 * nearest 'on_ground' oversized fragment that is actually path-connected to
 * the vehicle's current position. Returns null when none qualify.
 */
export function findReachableOversizedFragment(_state: GameState, _vehicleId: number): number | null {
  throw new Error('not implemented');
}
