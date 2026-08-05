// BlastSimulator2026 — Hauling task
//
// Position-gated debris hauling: a debris_hauler vehicle is dispatched to a
// fragment, loads it only on arrival, then drives to a depot building and
// delivers it only on arrival. ArrivalGate.ts drives the phase transitions.

import type { GameState } from '../state/GameState.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { findNearestActiveBuildingOfType, getBuildingDef, type Building } from '../entities/Building.js';
import { findBuildingApproachCell } from '../nav/BuildingApproach.js';
import { tickVehicle, tickVehicleTaskState } from '../engine/EntityMovementTick.js';
import { pickupFragment, deliverToDepot } from './Logistics.js';
import { isOversized } from '../mining/BlastCalc.js';
import { fragmentApproachCell } from './FragmentApproach.js';
import { findRequestVehicle, driveTowardFragment, findNearestReachableFragment } from './FragmentTaskLifecycle.js';

/**
 * True when `vehicle` is a debris_hauler with a driver assigned and no
 * hauling task already in progress — the shared eligibility gate for
 * findReachableGroundFragment and the UI's Haul button.
 *
 * requestHaulFragment keeps its own per-condition checks instead of calling
 * this: it reports which specific condition failed (no driver vs. already
 * hauling vs. wrong vehicle type), and collapsing that into one boolean
 * would lose those distinct error messages.
 */
export function isHaulEligibleVehicle(vehicle: Vehicle | undefined): vehicle is Vehicle {
  return !!vehicle && vehicle.type === 'debris_hauler' && vehicle.driverId !== null && vehicle.haulingPhase === null;
}

/**
 * Request that a debris_hauler vehicle haul a fragment to the nearest active
 * depot/warehouse building. Sets the vehicle's hauling intent (fragmentId,
 * phase, destination depot) without moving or loading it immediately —
 * ArrivalGate.tickArrivalGate and tickHaulingProgress drive the phases.
 */
export function requestHaulFragment(
  state: GameState,
  vehicleId: number,
  fragmentId: number,
): { success: boolean; error?: string } {
  const found = findRequestVehicle(state, vehicleId);
  if (!found.success) return found;
  const vehicle = found.vehicle;
  if (vehicle.type !== 'debris_hauler') return { success: false, error: 'Vehicle is not a debris hauler' };
  if (vehicle.driverId === null) return { success: false, error: 'Vehicle has no driver' };
  if (vehicle.haulingPhase !== null) return { success: false, error: 'Vehicle is already hauling' };

  const tracked = state.logistics.fragments.find(
    f => f.fragment.id === fragmentId && f.state === 'on_ground',
  );
  if (!tracked) return { success: false, error: 'Fragment not found or not on the ground' };
  if (isOversized(tracked.fragment.volume)) {
    return { success: false, error: 'Fragment is oversized and needs a Rock Fragmenter first' };
  }

  const depot = findNearestActiveBuildingOfType(state.buildings, 'freight_warehouse', vehicle.x, vehicle.z);
  if (!depot) return { success: false, error: 'No active freight warehouse available' };

  // Intent only — the vehicle does not load until tickHaulingProgress (driven
  // from ArrivalGate.tickArrivalGate) detects arrival. The movement target is
  // set immediately so tickVehicle has somewhere to drive toward each tick.
  const approach = fragmentApproachCell(tracked.fragment, state, vehicle.id);
  vehicle.haulingFragmentId = fragmentId;
  vehicle.haulingPhase = 'to_fragment';
  vehicle.haulingDepotBuildingId = depot.id;
  vehicle.targetX = approach.x;
  vehicle.targetZ = approach.z;

  return { success: true };
}

/**
 * Advance a single vehicle's in-progress hauling task by one tick: moves it
 * toward its current phase target, and on arrival transitions
 * 'to_fragment' -> load -> 'to_depot' -> deliver -> idle.
 */
export function tickHaulingProgress(state: GameState, vehicle: Vehicle): void {
  if (vehicle.haulingPhase === null) return;

  if (vehicle.haulingPhase === 'to_fragment') {
    const tracked = state.logistics.fragments.find(
      f => f.fragment.id === vehicle.haulingFragmentId && f.state === 'on_ground',
    );
    if (!tracked) {
      // Fragment gone (picked up/removed elsewhere) — abandon this haul.
      abortHaul(vehicle);
      return;
    }

    const arrived = driveTowardFragment(state, vehicle, tracked.fragment);

    if (arrived) {
      const loaded = pickupFragment(state.logistics, vehicle.haulingFragmentId!, String(vehicle.id));
      if (loaded) {
        vehicle.payloadKg = tracked.fragment.mass;
        vehicle.haulingPhase = 'to_depot';
        vehicle.task = 'transport';
        // Re-target toward the depot immediately so the vehicle has somewhere
        // to drive on its next movement tick.
        const depotBuilding = state.buildings.buildings.find(
          b => b.id === vehicle.haulingDepotBuildingId && b.active,
        );
        if (depotBuilding) {
          const approach = resolveDepotApproach(state, depotBuilding, vehicle);
          vehicle.targetX = approach.x;
          vehicle.targetZ = approach.z;
        }
      } else {
        // Storage full or fragment claimed by another vehicle this tick.
        abortHaul(vehicle);
      }
    }
    tickVehicleTaskState(vehicle);
    return;
  }

  // vehicle.haulingPhase === 'to_depot'
  const building = state.buildings.buildings.find(
    b => b.id === vehicle.haulingDepotBuildingId && b.active,
  );
  if (!building) {
    abortHaul(vehicle);
    return;
  }

  const approach = resolveDepotApproach(state, building, vehicle);
  vehicle.task = 'moving';
  vehicle.targetX = approach.x;
  vehicle.targetZ = approach.z;
  tickVehicle(state, vehicle);

  if (vehicle.x === vehicle.targetX && vehicle.z === vehicle.targetZ) {
    deliverToDepot(state.logistics, vehicle.haulingFragmentId!, state.collectedOre);
    vehicle.payloadKg = 0;
    vehicle.haulingFragmentId = null;
    vehicle.haulingPhase = null;
    vehicle.haulingDepotBuildingId = null;
    vehicle.task = 'idle';
  }
  tickVehicleTaskState(vehicle);
}

/**
 * Find a reachability-aware ground fragment for `vehicleId` to haul: the
 * nearest 'on_ground' fragment that is actually path-connected to the
 * vehicle's current position (via NavGrid.computeReachableSet), rather than
 * plain nearest-distance — a full-clear blast leaves most fragments in
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
 * Resolve the nearest walkable NavGrid cell on the ring around a depot
 * building, closest to the vehicle. A building's raw (x, z) is always
 * NavGrid-blocked (see findBuildingApproachCell's doc), so both hauling
 * legs that target a depot go through this instead (#437).
 */
function resolveDepotApproach(state: GameState, building: Building, vehicle: Vehicle): { x: number; z: number } {
  return findBuildingApproachCell(state.navGrid, building, getBuildingDef(building.type, building.tier), vehicle.x, vehicle.z);
}

/** Cancel an in-progress haul and return the vehicle to idle. */
function abortHaul(vehicle: Vehicle): void {
  vehicle.haulingFragmentId = null;
  vehicle.haulingPhase = null;
  vehicle.haulingDepotBuildingId = null;
  vehicle.payloadKg = 0;
  vehicle.task = 'idle';
}
