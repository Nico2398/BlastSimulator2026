// BlastSimulator2026 — Boulder breaking task
//
// Position-gated in-place breaking of an oversized fragment: a
// rock_fragmenter vehicle is dispatched to a boulder, breaks it only on
// arrival, replacing it in logistics with its sub-fragments. Itinerary-driven
// (#1091): PlanItinerary.ts's planFragmentTaskItinerary plans the single
// drive-to-boulder leg and ArrivalEffects.ts's boulder_split performs the
// split at that leg's arrival — this file keeps only the eligibility gate,
// the reachable-target search, and the request entry point, mirroring
// HaulingTask.ts's own reduced shape for the break workflow instead of the
// haul one.

import type { GameState } from '../state/GameState.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { isOversized } from '../mining/BlastCalc.js';
import { findNearestReachableFragment } from './FragmentTaskLifecycle.js';

/**
 * True when `vehicle` is a rock_fragmenter with a driver assigned and no
 * break task already in progress — the shared eligibility gate for
 * findReachableOversizedFragment and the UI's Break button.
 */
export function isBreakEligibleVehicle(vehicle: Vehicle | undefined): vehicle is Vehicle {
  return !!vehicle && vehicle.type === 'rock_fragmenter' && vehicle.driverId !== null && vehicle.reservedForActionId === null;
}

/**
 * Request that a rock_fragmenter vehicle break an oversized fragment in
 * place. Itinerary-driven (#1091): the actual drive/split sequence is
 * planned by PlanItinerary.ts's planFragmentTaskItinerary and executed via
 * ArrivalEffects.ts's boulder_split, rather than this function setting phase
 * fields directly — it validates eligibility and reports the same Result<T>
 * shape the console command and existing tests depend on.
 */
export function requestBreakBoulder(
  state: GameState,
  vehicleId: number,
  fragmentId: number,
): { success: boolean; error?: string } {
  void state; void vehicleId; void fragmentId;
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Find a reachability-aware oversized fragment for `vehicleId` to break: the
 * nearest 'on_ground' oversized fragment that is actually path-connected to
 * the vehicle's current position. No storage-room check — breaking never
 * touches the warehouse, unlike hauling. Returns null when none qualify.
 */
export function findReachableOversizedFragment(state: GameState, vehicleId: number): number | null {
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (!isBreakEligibleVehicle(vehicle)) return null;

  return findNearestReachableFragment(
    state,
    vehicleId,
    vehicle.x,
    vehicle.z,
    tracked => isOversized(tracked.fragment.volume),
  );
}
