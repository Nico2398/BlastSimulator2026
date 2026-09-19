// BlastSimulator2026 — Shared task-lifecycle helpers for fragment-targeting vehicle tasks
//
// BoulderBreaking.ts (breaking) and HaulingTask.ts (hauling) are both
// position-gated vehicle tasks that target a fragment: request looks up and
// validates the vehicle, search picks the nearest reachable candidate
// fragment, and claimAndDispatchFragmentAction runs the claim/reserve/
// dispatch tail once the caller's own eligibility checks pass. These four
// exports are those steps, shared so BoulderBreaking.ts and HaulingTask.ts
// only carry what differs between them: eligibility rules and what happens
// on arrival (now ArrivalEffects.ts, #1091).
//
// The per-tick driving step and the vehicle-gated request/abort entry points
// this file used to also share (driveTowardFragment,
// startVehicleGatedFragmentWork, abortVehicleGatedFragmentWork,
// isMidLoadedHaul) moved to itinerary planning and arrival effects (#1091) —
// PlanItinerary.ts's planFragmentTaskItinerary now plans the drive legs
// ArrivalGate.ts/VehicleReservation.ts used to kick off here.

import type { ActionType, GameState } from '../state/GameState.js';
import type { Vehicle, VehicleRole } from '../entities/Vehicle.js';
import { resolveVehicleDriver } from '../entities/Vehicle.js';
import type { TrackedFragment } from './Logistics.js';
import { fragmentApproachCell } from './FragmentApproach.js';
import { NavGrid } from '../nav/NavGrid.js';
import { claimPendingAction } from '../engine/TaskDispatch.js';
import { reserveVehicle } from '../engine/VehicleReservation.js';
import { moveTo } from '../engine/MoveTo.js';
import { t } from '../i18n/I18n.js';

/**
 * Look up `vehicleId` for a request-phase task entry point (requestBreakBoulder,
 * requestHaulFragment). Both callers keep their own further checks (vehicle
 * type, driver assigned, not already busy) — this only covers the one check
 * that's identical between them: does the vehicle exist at all.
 */
export function findRequestVehicle(
  state: GameState,
  vehicleId: number,
): { success: true; vehicle: Vehicle } | { success: false; error: string } {
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return { success: false, error: 'Vehicle not found' };
  return { success: true, vehicle };
}

/**
 * Look up `vehicleId` and confirm it is a `expectedRole` vehicle, in one step
 * — the first two checks requestBreakBoulder and requestHaulFragment both
 * run before diverging into their own role-specific conditions (driver
 * assigned, not already busy). `wrongRoleError` carries the caller's own
 * wording so the two request entry points keep their distinct error messages.
 */
export function findRequestVehicleOfRole(
  state: GameState,
  vehicleId: number,
  expectedRole: VehicleRole,
  wrongRoleError: string,
): { success: true; vehicle: Vehicle } | { success: false; error: string } {
  const found = findRequestVehicle(state, vehicleId);
  if (!found.success) return found;
  if (found.vehicle.type !== expectedRole) return { success: false, error: wrongRoleError };
  return found;
}

/**
 * Nearest 'on_ground' fragment reachable from (originX, originZ) via NavGrid's
 * climb-aware reachable set (#953/#959) — same climb gate real pathfinding
 * applies, so a fragment across a slope steeper than NAV_MAX_SLOPE_DEGREES is
 * never picked as "nearest" only to have the vehicle freeze mid-drive when
 * findPath refuses the step. Among fragments `extraEligible` accepts — the
 * search and reachability check are identical between
 * findReachableOversizedFragment (breaking) and findReachableGroundFragment
 * (hauling); only the per-fragment eligibility predicate differs
 * (oversized-only vs. non-oversized-and-fits-in-storage).
 */
export function findNearestReachableFragment(
  state: GameState,
  vehicleId: number,
  originX: number,
  originZ: number,
  extraEligible: (tracked: TrackedFragment) => boolean,
): number | null {
  if (!state.navGrid) return null;

  const reachable = NavGrid.computeClimbReachableSet(state.navGrid, originX, originZ);
  if (reachable.size === 0) return null;

  let bestId: number | null = null;
  let bestDistSq = Infinity;
  for (const tracked of state.logistics.fragments) {
    if (tracked.state !== 'on_ground') continue;
    if (!extraEligible(tracked)) continue;
    const { x: fx, z: fz } = fragmentApproachCell(tracked.fragment, state, vehicleId);
    if (!reachable.has(fx, fz)) continue;
    const distSq = (fx - originX) ** 2 + (fz - originZ) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestId = tracked.fragment.id;
    }
  }

  return bestId;
}

/**
 * The claim/reserve/dispatch tail shared by requestHaulFragment
 * (HaulingTask.ts) and requestBreakBoulder (BoulderBreaking.ts): finds the
 * fragment's existing self-dispatched queued action of `actionType`, claims
 * it on behalf of `vehicle`'s driver, reserves the vehicle for it, and calls
 * moveTo to plan and start the actual itinerary — mechanically identical
 * between the two callers, which keep only their own eligibility checks
 * (payload-null for haul, oversized-direction for break) before calling
 * this (#1091).
 */
export function claimAndDispatchFragmentAction(
  state: GameState,
  vehicle: Vehicle,
  actionType: ActionType,
  fragmentId: number,
  noActionQueuedKey: string,
  claimFailedKey: string,
): { success: true } | { success: false; error: string } {
  const action = state.pendingActions.find(a =>
    a.type === actionType && a.status === 'queued' && a.payload['fragmentId'] === fragmentId);
  if (!action) return { success: false, error: t(noActionQueuedKey) };

  const employee = resolveVehicleDriver(vehicle, state.employees.employees);
  if (!employee) return { success: false, error: 'Vehicle has no driver' };

  const claimed = claimPendingAction(state, action.id, employee.id);
  if (!claimed) return { success: false, error: t(claimFailedKey) };
  reserveVehicle(state.vehicles, vehicle.id, claimed.id);
  employee.activeActionId = claimed.id;

  const moveResult = moveTo(state, employee.id, { actionId: claimed.id }, { via: vehicle.id });
  if (!moveResult.success) return { success: false, error: moveResult.error };

  return { success: true };
}
