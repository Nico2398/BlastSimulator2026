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
import type { Vehicle } from '../entities/Vehicle.js';
import { isOversized } from '../mining/BlastCalc.js';
import { findNearestReachableFragment } from './FragmentTaskLifecycle.js';

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
export function isHaulEligibleVehicle(vehicle: Vehicle | undefined): vehicle is Vehicle {
  return !!vehicle && vehicle.type === 'debris_hauler' && vehicle.driverId !== null && vehicle.reservedForActionId === null;
}

/**
 * Request that a debris_hauler vehicle haul a fragment to the nearest active
 * depot/warehouse building. Itinerary-driven (#1091): the actual drive/load/
 * deliver sequence is planned by PlanItinerary.ts's planFragmentTaskItinerary
 * and executed leg by leg via ArrivalEffects.ts, rather than this function
 * setting phase fields directly — it validates eligibility and reports the
 * same Result<T> shape the console command and existing tests depend on.
 */
export function requestHaulFragment(
  state: GameState,
  vehicleId: number,
  fragmentId: number,
): { success: boolean; error?: string } {
  void state; void vehicleId; void fragmentId;
  // TODO: implement
  throw new Error('not implemented');
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
  if (!isHaulEligibleVehicle(vehicle)) return null;

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
  void state; void fromX; void fromZ;
  // TODO: implement
  throw new Error('not implemented');
}
