// BlastSimulator2026 — Tests for tickLocomotion and driveVehicleTowardTarget
// (src/core/engine/Locomotion.ts, #1089 mount/itinerary rebuild phase 3b).
//
// tickLocomotion is the ONLY mover: it walks every alive employee's current
// itinerary leg (or, for an employee with no itinerary, the legacy
// destinationX/Z single foot leg) one tick's worth of movement, and — for a
// mounted employee — writes their vehicle's x/z from theirs. This is the sole
// place a vehicle's position ever changes (gameplay-vehicle-fleet skill,
// `vehicles` rule). tickVehicle/tickEmployeeMovement (EntityMovementTick.ts)
// still exist at this (red) phase, so these tests exercise the NEW module
// directly rather than through the old tick pipeline.
//
// Locomotion.ts is a stub that throws 'not implemented' at this phase — every
// test below is expected to fail for that reason, not from a fixture bug.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, getVehicleDefByTier } from '../../../src/core/entities/Vehicle.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { AGENT_WALK_SPEED, VEHICLE_OCCUPANCY_REROUTE_THRESHOLD } from '../../../src/core/config/balance.js';
import { tickLocomotion, driveVehicleTowardTarget } from '../../../src/core/engine/Locomotion.js';
import type { Itinerary } from '../../../src/core/engine/Itinerary.js';

const SEED = 42;

/** Solid rock voxel — same fixture shape used throughout the existing movement suites. */
function solidVoxel() {
  return { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
}

/** A fully walkable flat NavGrid, wide enough for long straight drives. */
function buildFlatNavGridState(sizeX: number, sizeZ: number): GameState {
  const state = createGame({ seed: SEED });
  const vg = new VoxelGrid(sizeX, 2, sizeZ);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      vg.setVoxel(x, 0, z, solidVoxel());
    }
  }
  state.navGrid = NavGrid.buildNavGrid(vg, [], []);
  return state;
}

/** 1-cell-wide horizontal corridor (only row z=1 solid) — no detour around any obstacle placed in it can exist. */
function buildCorridorState(sizeX: number): GameState {
  const state = createGame({ seed: SEED });
  const vg = new VoxelGrid(sizeX, 2, 3);
  for (let x = 0; x < sizeX; x++) {
    vg.setVoxel(x, 0, 1, solidVoxel());
  }
  state.navGrid = NavGrid.buildNavGrid(vg, [], []);
  return state;
}

describe('tickLocomotion', () => {
  it('advances a mounted employee at the vehicle\'s tiered speed, not AGENT_WALK_SPEED, and the vehicle tracks the employee\'s position', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0, 1);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const speed = getVehicleDefByTier(vehicle.type, vehicle.tier).speed;
    expect(speed).not.toBe(AGENT_WALK_SPEED);

    employee.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 12, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: Math.ceil(12 / speed),
      }],
      goal: { kind: 'reposition', x: 12, z: 0 },
      workTicks: 0,
      estTotalTicks: Math.ceil(12 / speed),
    } satisfies Itinerary;

    tickLocomotion(state);

    expect(employee.x).toBe(speed);
    expect(employee.z).toBe(0);
    expect(vehicle.x).toBe(employee.x);
    expect(vehicle.z).toBe(employee.z);
  });

  it('advances an on-foot employee with an itinerary foot leg at AGENT_WALK_SPEED', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    employee.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: 12, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 6,
      }],
      goal: { kind: 'reposition', x: 12, z: 0 },
      workTicks: 0,
      estTotalTicks: 6,
    } satisfies Itinerary;

    tickLocomotion(state);

    expect(employee.x).toBe(AGENT_WALK_SPEED);
    expect(employee.z).toBe(0);
  });

  it('advances an on-foot employee with no itinerary but destinationX/Z set (legacy single foot leg) at AGENT_WALK_SPEED', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.itinerary = null;
    employee.destinationX = 12;
    employee.destinationZ = 0;

    tickLocomotion(state);

    expect(employee.x).toBe(AGENT_WALK_SPEED);
    expect(employee.z).toBe(0);
  });

  it('never changes an unoccupied vehicle\'s x/z across 10 ticks, regardless of any stray targetX/targetZ', () => {
    const state = buildFlatNavGridState(20, 5);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.occupantIds = [];
    vehicle.targetX = 19;
    vehicle.targetZ = 4;

    for (let i = 0; i < 10; i++) {
      tickLocomotion(state);
      expect(vehicle.x).toBe(5);
      expect(vehicle.z).toBe(5);
    }
  });

  it('waits on a blocked drive leg, attempts exactly one reroute, then sets employee.isMoveStuck and stops the vehicle — scaled by VEHICLE_OCCUPANCY_REROUTE_THRESHOLD, not an arbitrary iteration count', () => {
    const state = buildCorridorState(5);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 1);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 4, destZ: 1,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 4,
      }],
      goal: { kind: 'reposition', x: 4, z: 1 },
      workTicks: 0,
      estTotalTicks: 4,
    } satisfies Itinerary;

    // Stationary, unoccupied blocker sitting directly on the only route
    // through the 1-wide corridor — never moves out of the way on its own.
    purchaseVehicle(state.vehicles, 'drill_rig', 2, 1);

    for (let i = 0; i < 1 + VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 2; i++) {
      tickLocomotion(state);
    }

    expect(driver.isMoveStuck).toBe(true);
    // Never advanced past the cell right before the blocker.
    expect(vehicle.x).toBe(1);
    expect(vehicle.z).toBe(1);

    const stuckX = vehicle.x;
    const stuckZ = vehicle.z;
    tickLocomotion(state);
    expect(vehicle.x).toBe(stuckX);
    expect(vehicle.z).toBe(stuckZ);
  });

  it('applies a non-final leg\'s onArrive step (board) on arrival and continues the itinerary to the next leg', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    // 1 cell away — well within a single tick's AGENT_WALK_SPEED (2).
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 1, 0);

    employee.itinerary = {
      legs: [
        {
          mode: 'foot', vehicleId: vehicle.id, destX: vehicle.x, destZ: vehicle.z,
          arrival: 'adjacent', onArrive: { kind: 'board', vehicleId: vehicle.id }, estTicks: 1,
        },
        {
          mode: 'drive', vehicleId: vehicle.id, destX: 10, destZ: 0,
          arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 9,
        },
      ],
      goal: { kind: 'reposition', x: 10, z: 0 },
      workTicks: 0,
      estTotalTicks: 10,
    } satisfies Itinerary;

    tickLocomotion(state);

    expect(vehicle.occupantIds).toContain(employee.id);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    // Itinerary continues — the drive leg is still pending, not abandoned.
    expect(employee.itinerary).not.toBeNull();
    expect(employee.itinerary!.legs).toHaveLength(1);
    expect(employee.itinerary!.legs[0]!.mode).toBe('drive');
  });

  it('clears the itinerary once the FINAL leg is reached', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    employee.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: 1, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 1,
      }],
      goal: { kind: 'reposition', x: 1, z: 0 },
      workTicks: 0,
      estTotalTicks: 1,
    } satisfies Itinerary;

    tickLocomotion(state);

    expect(employee.x).toBe(1);
    expect(employee.z).toBe(0);
    expect(employee.itinerary).toBeNull();
  });

  it('is a no-op for an employee with no itinerary and no legacy destination (boundary)', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 3, 4);
    employee.itinerary = null;
    employee.destinationX = null;
    employee.destinationZ = null;

    expect(() => tickLocomotion(state)).not.toThrow();
    expect(employee.x).toBe(3);
    expect(employee.z).toBe(4);
  });
});

describe('driveVehicleTowardTarget', () => {
  it('advances an already-boarded vehicle toward (targetX, targetZ) at its own tiered speed, independent of any itinerary', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    employee.itinerary = null; // ad hoc phase-driving — no itinerary involved at all

    const speed = getVehicleDefByTier(vehicle.type, vehicle.tier).speed;

    const result = driveVehicleTowardTarget(state, vehicle, 12, 0);

    expect(result.arrived).toBe(false);
    expect(vehicle.x).toBe(speed);
    expect(vehicle.z).toBe(0);
    // The driver's own position tracks the vehicle.
    expect(employee.x).toBe(speed);
    expect(employee.z).toBe(0);
  });

  it('reports arrived: true and the vehicle sits exactly at the target once reached (boundary: within one tick\'s reach)', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    let result = { arrived: false };
    for (let i = 0; i < 10 && !result.arrived; i++) {
      result = driveVehicleTowardTarget(state, vehicle, 3, 0);
    }

    expect(result.arrived).toBe(true);
    expect(vehicle.x).toBe(3);
    expect(vehicle.z).toBe(0);
  });

  it('is a no-op (arrived: false, position unchanged) when the vehicle has no occupant (rejection)', () => {
    const state = buildFlatNavGridState(20, 5);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    vehicle.occupantIds = [];

    const result = driveVehicleTowardTarget(state, vehicle, 19, 4);

    expect(result.arrived).toBe(false);
    expect(vehicle.x).toBe(5);
    expect(vehicle.z).toBe(5);
  });
});
