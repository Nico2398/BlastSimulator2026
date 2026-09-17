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
import { findNearestReachableFragment, findRequestVehicleOfRole } from './FragmentTaskLifecycle.js';
import { claimPendingAction } from '../engine/TaskDispatch.js';
import { reserveVehicle } from '../engine/VehicleReservation.js';
import { moveTo } from '../engine/MoveTo.js';
import { t } from '../i18n/I18n.js';

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
 * place. Itinerary-driven (#1091): mirrors HaulingTask.ts's own
 * requestHaulFragment — claims the fragment's existing (self-dispatched)
 * fragment_debris PendingAction on behalf of the vehicle's driver, reserves
 * the vehicle for it, and calls moveTo, which plans the actual
 * drive-then-split itinerary via PlanItinerary.ts's planFragmentTaskItinerary
 * and executes it via ArrivalEffects.ts's boulder_split. The one entry point
 * both the manual `vehicle break` console command and this file's own
 * eligibility gate above rely on; self-dispatch reaches the same itinerary
 * through the ordinary employee-claim pipeline (EmployeeDispatchSteps.ts)
 * instead, never through this function.
 */
export function requestBreakBoulder(
  state: GameState,
  vehicleId: number,
  fragmentId: number,
): { success: boolean; error?: string } {
  const found = findRequestVehicleOfRole(state, vehicleId, 'rock_fragmenter', 'Vehicle is not a rock fragmenter');
  if (!found.success) return found;
  const vehicle = found.vehicle;
  if (vehicle.driverId === null) return { success: false, error: 'Vehicle has no driver' };
  if (vehicle.reservedForActionId !== null) {
    return { success: false, error: 'Vehicle is already breaking a fragment' };
  }

  const tracked = state.logistics.fragments.find(
    f => f.fragment.id === fragmentId && f.state === 'on_ground',
  );
  if (!tracked) return { success: false, error: 'Fragment not found or not on the ground' };
  if (!isOversized(tracked.fragment.volume)) return { success: false, error: 'Fragment is not oversized' };

  const action = state.pendingActions.find(a =>
    a.type === 'fragment_debris' && a.status === 'queued' && a.payload['fragmentId'] === fragmentId);
  if (!action) return { success: false, error: t('break.no_action_queued') };

  const employee = state.employees.employees.find(e => e.id === vehicle.driverId);
  if (!employee) return { success: false, error: 'Vehicle has no driver' };

  const claimed = claimPendingAction(state, action.id, employee.id);
  if (!claimed) return { success: false, error: t('break.claim_failed') };
  reserveVehicle(vehicle, claimed.id);
  employee.activeActionId = claimed.id;

  const moveResult = moveTo(state, employee.id, { actionId: claimed.id }, { via: vehicle.id });
  if (!moveResult.success) return { success: false, error: moveResult.error };

  return { success: true };
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
