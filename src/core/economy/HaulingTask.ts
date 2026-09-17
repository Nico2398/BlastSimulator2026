// BlastSimulator2026 — Hauling task
//
// Position-gated debris hauling: a debris_hauler vehicle is dispatched to a
// fragment, loads it only on arrival, then drives to a depot building and
// delivers it only on arrival. Itinerary-driven (#1091): PlanItinerary.ts's
// planFragmentTaskItinerary plans the two driving legs (to the fragment, then
// to the depot) and ArrivalEffects.ts's haul_load/haul_unload perform the
// load/deliver mutations at each leg's arrival — this file keeps only the
// eligibility gate, the reachable-fragment search, the depot-approach lookup,
// and the request entry point, none of which are itinerary/effect concerns
// of their own.

import type { GameState } from '../state/GameState.js';
import type { Vehicle, VehicleState } from '../entities/Vehicle.js';
import { vehicleDriverId, getVehicleReservation } from '../entities/Vehicle.js';
import { isOversized } from '../mining/BlastCalc.js';
import { findNearestReachableFragment, findRequestVehicleOfRole, claimAndDispatchFragmentAction } from './FragmentTaskLifecycle.js';
import { findNearestActiveBuildingOfType, getBuildingDef } from '../entities/Building.js';
import { findBuildingApproachCell } from '../nav/BuildingApproach.js';

/**
 * True when `vehicle` is a debris_hauler with a driver assigned and no
 * hauling task already in progress — the eligibility gate for
 * findReachableGroundFragment, used by the manual `vehicle haul` console
 * command and tests. Hauling is otherwise self-dispatching (HaulDispatch.ts,
 * #552); there is no Haul button on the Fleet panel anymore.
 *
 * requestHaulFragment keeps its own per-condition checks instead of calling
 * this: it reports which specific condition failed (no driver vs. already
 * hauling vs. wrong vehicle type), and collapsing that into one boolean
 * would lose those distinct error messages.
 */
export function isHaulEligibleVehicle(vehicle: Vehicle | undefined, vehicleState: VehicleState): vehicle is Vehicle {
  return !!vehicle && vehicle.type === 'debris_hauler' && vehicleDriverId(vehicle) !== null
    && getVehicleReservation(vehicleState, vehicle.id) === null;
}

/**
 * Request that a debris_hauler vehicle haul a fragment to the nearest active
 * depot/warehouse building. Itinerary-driven (#1091): rather than setting
 * phase fields directly, this claims the fragment's existing (self-dispatched
 * — see HaulDispatch.ts's syncHaulDispatch) haul_debris PendingAction on
 * behalf of the vehicle's driver, reserves the vehicle for it, and calls
 * moveTo, which plans the actual drive/load/deliver itinerary via
 * PlanItinerary.ts's planFragmentTaskItinerary and executes it leg by leg via
 * ArrivalEffects.ts. The one entry point both the manual `vehicle haul`
 * console command and this file's own eligibility gate above rely on; self-
 * dispatch reaches the same itinerary through the ordinary employee-claim
 * pipeline (EmployeeDispatchSteps.ts) instead, never through this function.
 */
export function requestHaulFragment(
  state: GameState,
  vehicleId: number,
  fragmentId: number,
): { success: boolean; error?: string } {
  const found = findRequestVehicleOfRole(state, vehicleId, 'debris_hauler', 'Vehicle is not a debris hauler');
  if (!found.success) return found;
  const vehicle = found.vehicle;
  if (vehicleDriverId(vehicle) === null) return { success: false, error: 'Vehicle has no driver' };
  if (getVehicleReservation(state.vehicles, vehicle.id) !== null || vehicle.payload !== null) {
    return { success: false, error: 'Vehicle is already hauling' };
  }

  const tracked = state.logistics.fragments.find(
    f => f.fragment.id === fragmentId && f.state === 'on_ground',
  );
  if (!tracked) return { success: false, error: 'Fragment not found or not on the ground' };
  if (isOversized(tracked.fragment.volume)) {
    return { success: false, error: 'Fragment is oversized and needs a Rock Fragmenter first' };
  }

  return claimAndDispatchFragmentAction(state, vehicle, 'haul_debris', fragmentId, 'haul.no_action_queued', 'haul.claim_failed');
}

/**
 * Find a reachability-aware ground fragment for `vehicleId` to haul: the
 * nearest 'on_ground' fragment that is actually path-connected to the
 * vehicle's current position (via NavGrid.computeClimbReachableSet), rather
 * than plain nearest-distance — a full-clear blast leaves most fragments in
 * unreachable 'void' NavGrid cells. Returns null when none qualify.
 */
export function findReachableGroundFragment(state: GameState, vehicleId: number): number | null {
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (!isHaulEligibleVehicle(vehicle, state.vehicles)) return null;

  const roomKg = state.logistics.storageCapacityKg - state.logistics.storedMassKg;

  return findNearestReachableFragment(state, vehicleId, vehicle.x, vehicle.z, tracked => {
    // An oversized fragment can never be hauled until a Rock Fragmenter
    // breaks it into sub-fragments first (#484) — offering it here would
    // dispatch a hauler that requestHaulFragment immediately rejects.
    if (isOversized(tracked.fragment.volume)) return false;
    // A fragment heavier than the room left in storage can never be delivered:
    // the hauler would drive to it, load it, drive to the depot and be turned
    // away every tick from then on. Blasts throw off boulders far heavier than
    // an early warehouse holds, so skipping them here is what keeps the fleet
    // working instead of silently deadlocked on the nearest rock.
    if (tracked.fragment.mass > roomKg) return false;
    return true;
  });
}

/**
 * Nearest walkable NavGrid approach cell, from (`fromX`, `fromZ`), around the
 * nearest active freight_warehouse depot building — the itinerary-planning
 * replacement for the old tickHaulingProgress's own per-tick depot re-target
 * (formerly `resolveDepotApproach`, inlined per-tick since the depot leg only
 * needs resolving once now, at plan time). Returns null when no active depot
 * exists.
 */
export function findHaulDepotApproach(state: GameState, fromX: number, fromZ: number): { x: number; z: number } | null {
  const depot = findNearestActiveBuildingOfType(state.buildings, 'freight_warehouse', fromX, fromZ);
  if (!depot) return null;
  return findBuildingApproachCell(state.navGrid, depot, getBuildingDef(depot.type, depot.tier), fromX, fromZ);
}
