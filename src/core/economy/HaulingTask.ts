// BlastSimulator2026 — Hauling task
//
// Position-gated debris hauling: a debris_hauler vehicle is dispatched to a
// fragment, loads it only on arrival, then drives to a depot building and
// delivers it only on arrival. ArrivalGate.ts drives the phase transitions.

import type { GameState } from '../state/GameState.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { findNearestActiveBuildingOfType, getBuildingDef } from '../entities/Building.js';
import { findBuildingApproachCell } from '../nav/BuildingApproach.js';
import { tickVehicle, tickVehicleTaskState } from '../engine/EntityMovementTick.js';
import { pickupFragment, deliverToDepot } from './Logistics.js';

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
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return { success: false, error: 'Vehicle not found' };
  if (vehicle.type !== 'debris_hauler') return { success: false, error: 'Vehicle is not a debris hauler' };
  if (vehicle.haulingPhase !== null) return { success: false, error: 'Vehicle is already hauling' };

  const tracked = state.logistics.fragments.find(
    f => f.fragment.id === fragmentId && f.state === 'on_ground',
  );
  if (!tracked) return { success: false, error: 'Fragment not found or not on the ground' };

  const depot = findNearestActiveBuildingOfType(state.buildings, 'freight_warehouse', vehicle.x, vehicle.z);
  if (!depot) return { success: false, error: 'No active freight warehouse available' };

  // Intent only — the vehicle does not move or load until tickHaulingProgress
  // (driven from ArrivalGate.tickArrivalGate) walks it to the fragment first.
  vehicle.haulingFragmentId = fragmentId;
  vehicle.haulingPhase = 'to_fragment';
  vehicle.haulingDepotBuildingId = depot.id;

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

    vehicle.task = 'moving';
    vehicle.targetX = Math.round(tracked.fragment.position.x);
    vehicle.targetZ = Math.round(tracked.fragment.position.z);
    tickVehicle(state, vehicle);

    if (vehicle.x === vehicle.targetX && vehicle.z === vehicle.targetZ) {
      const loaded = pickupFragment(state.logistics, vehicle.haulingFragmentId!, String(vehicle.id));
      if (loaded) {
        vehicle.payloadKg = tracked.fragment.mass;
        vehicle.haulingPhase = 'to_depot';
        vehicle.task = 'transport';
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

  // A building's raw (x, z) is always NavGrid-blocked (see
  // findBuildingApproachCell's doc) — target the nearest walkable ring cell
  // around the depot instead (#437).
  const approach = findBuildingApproachCell(state.navGrid, building, getBuildingDef(building.type, building.tier), vehicle.x, vehicle.z);
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

/** Cancel an in-progress haul and return the vehicle to idle. */
function abortHaul(vehicle: Vehicle): void {
  vehicle.haulingFragmentId = null;
  vehicle.haulingPhase = null;
  vehicle.haulingDepotBuildingId = null;
  vehicle.payloadKg = 0;
  vehicle.task = 'idle';
}
