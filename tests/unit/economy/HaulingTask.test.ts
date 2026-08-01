// BlastSimulator2026 — Tests for HaulingTask (issue #437)
//
// requestHaulFragment dispatches a debris_hauler toward a ground fragment
// without loading it immediately; tickHaulingProgress advances the vehicle
// through to_fragment -> pickup -> to_depot -> deliver -> idle, only acting
// on arrival (never mid-transit).

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { requestHaulFragment, tickHaulingProgress } from '../../../src/core/economy/HaulingTask.js';

const SEED = 42;
const GRID = 64;

function makeFragment(id: number, x: number, z: number, mass = 1000): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume: 1.0,
    mass,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
  };
}

/** A driverless debris_hauler with no active haul. */
function makeIdleHauler(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  return purchaseVehicle(state.vehicles, 'debris_hauler', x, z).vehicle;
}

/** A debris_hauler with a licensed driver already boarded (driverId set). */
function makeDrivenHauler(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  const vehicle = makeIdleHauler(state, x, z);
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driver', rng);
  assignSkill(state.employees, employee.id, 'driving.truck', 1);
  vehicle.driverId = employee.id;
  return vehicle;
}

function placeWarehouse(state: ReturnType<typeof createGame>, x: number, z: number) {
  const result = placeBuilding(state.buildings, 'freight_warehouse', x, z, GRID, GRID);
  if (!result.success) throw new Error(`Setup: placeBuilding failed — ${result.error}`);
  return result.building!;
}

// ── requestHaulFragment — precondition failures ─────────────────────────────

describe('requestHaulFragment — precondition failures', () => {
  it('rejects a non-debris_hauler vehicle', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    assignSkill(state.employees, employee.id, 'driving.excavator', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.driverId = employee.id;
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a vehicle with no driver', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeIdleHauler(state);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a vehicle that is already hauling', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state);
    vehicle.haulingFragmentId = 999;
    vehicle.haulingPhase = 'to_fragment';
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a fragment that is not on_ground (already in_transit)', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);
    state.logistics.fragments[0]!.state = 'in_transit';

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a fragment ID that does not exist', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state);

    const result = requestHaulFragment(state, vehicle.id, 9999);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects when no active freight_warehouse exists', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenHauler(state);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects an unknown vehicle ID', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, 9999, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ── requestHaulFragment — happy path defers movement/loading ───────────────

describe('requestHaulFragment — happy path', () => {
  it('sets the vehicle destination toward the fragment and marks the haul pending', () => {
    const state = createGame({ seed: SEED });
    const warehouse = placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 7)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(vehicle.targetX).toBe(5);
    expect(vehicle.targetZ).toBe(7);
    expect(vehicle.haulingFragmentId).toBe(1);
    expect(vehicle.haulingPhase).toBe('to_fragment');
    expect(vehicle.haulingDepotBuildingId).toBe(warehouse.id);
    // The core contract under test: no synchronous pickup.
    expect(state.logistics.fragments[0]!.state).toBe('on_ground');
  });

  it('routes to the nearest active freight_warehouse when several exist', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 40, 40); // far
    const near = placeWarehouse(state, 6, 6); // near
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(true);
    expect(vehicle.haulingDepotBuildingId).toBe(near.id);
  });
});

// ── tickHaulingProgress — no-op while travelling ────────────────────────────

describe('tickHaulingProgress — travelling', () => {
  it('does nothing while the vehicle has not yet arrived at the fragment', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);
    requestHaulFragment(state, vehicle.id, 1);

    // Still en route: task is 'moving' and position has not reached the fragment.
    vehicle.task = 'moving';
    vehicle.x = 1;
    vehicle.z = 1;

    tickHaulingProgress(state, vehicle);

    expect(state.logistics.fragments[0]!.state).toBe('on_ground');
    expect(vehicle.haulingPhase).toBe('to_fragment');
  });
});

// ── tickHaulingProgress — arrival at the fragment ───────────────────────────

describe('tickHaulingProgress — arrival at fragment', () => {
  it('loads the fragment on arrival and re-targets the vehicle toward the depot', () => {
    const state = createGame({ seed: SEED });
    const warehouse = placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);
    requestHaulFragment(state, vehicle.id, 1);

    // Arrived: task idle, position matches the fragment.
    vehicle.task = 'idle';
    vehicle.x = 5;
    vehicle.z = 5;

    tickHaulingProgress(state, vehicle);

    expect(state.logistics.fragments[0]!.state).toBe('in_transit');
    expect(vehicle.haulingPhase).toBe('to_depot');
    expect(vehicle.targetX).toBe(warehouse.x);
    expect(vehicle.targetZ).toBe(warehouse.z);
  });
});

// ── tickHaulingProgress — arrival at the depot ──────────────────────────────

describe('tickHaulingProgress — arrival at depot', () => {
  it('delivers the fragment on arrival, increases stored mass, and clears hauling fields', () => {
    const state = createGame({ seed: SEED });
    const warehouse = placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1200)]);
    requestHaulFragment(state, vehicle.id, 1);

    // First leg: arrive at fragment, load it.
    vehicle.task = 'idle';
    vehicle.x = 5;
    vehicle.z = 5;
    tickHaulingProgress(state, vehicle);
    expect(state.logistics.fragments[0]!.state).toBe('in_transit');

    const storedBefore = state.logistics.storedMassKg;

    // Second leg: arrive at the depot.
    vehicle.task = 'idle';
    vehicle.x = warehouse.x;
    vehicle.z = warehouse.z;
    tickHaulingProgress(state, vehicle);

    expect(state.logistics.fragments[0]!.state).toBe('stored');
    expect(state.logistics.storedMassKg).toBe(storedBefore + 1200);
    expect(vehicle.haulingFragmentId).toBeNull();
    expect(vehicle.haulingPhase).toBeNull();
    expect(vehicle.haulingDepotBuildingId).toBeNull();
    expect(vehicle.task).toBe('idle');
  });
});
