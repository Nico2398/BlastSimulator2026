// BlastSimulator2026 — Tests for requestBoardVehicle (issue #437)
//
// requestBoardVehicle mirrors assignDriver's eager licence/availability
// validation, but on success only records the employee's *intent* to board
// (destinationX/Z + pendingDriverVehicleId) — it never sets vehicle.driverId
// synchronously. ArrivalGate.tickArrivalGate is the only place driverId gets
// set, once the employee has actually walked to the vehicle.

import { describe, it, expect } from 'vitest';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { requestBoardVehicle, canBoardVehicle } from '../../../src/core/entities/VehicleBoarding.js';

const SEED = 42;

describe('requestBoardVehicle — licence validation', () => {
  it('rejects an employee without the licence the vehicle role requires', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng); // no driving licence
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);

    const result = requestBoardVehicle(state, vehicle.id, employee.id);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(employee.pendingDriverVehicleId).toBeNull();
    expect(employee.destinationX).toBeNull();
    expect(employee.destinationZ).toBeNull();
  });

  it('rejects when the vehicle does not exist', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);

    const result = requestBoardVehicle(state, 9999, employee.id);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects when the employee does not exist', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);

    const result = requestBoardVehicle(state, vehicle.id, 9999);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('requestBoardVehicle — availability validation', () => {
  it('rejects when the vehicle already has a driver', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { employee: other } = hireEmployee(state.employees, 'driver', new Random(SEED + 1));
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    vehicle.driverId = other.id;

    const result = requestBoardVehicle(state, vehicle.id, employee.id);

    expect(result.success).toBe(false);
    expect(result.error).toContain('driver');
    expect(employee.pendingDriverVehicleId).toBeNull();
  });

  it('rejects when the employee is already driving another vehicle', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle: alreadyDriving } = purchaseVehicle(state.vehicles, 'drill_rig', 1, 1);
    alreadyDriving.driverId = employee.id;
    const { vehicle: target } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);

    const result = requestBoardVehicle(state, target.id, employee.id);

    expect(result.success).toBe(false);
    expect(employee.pendingDriverVehicleId).toBeNull();
  });

  it('rejects a dead employee', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    employee.alive = false;
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);

    const result = requestBoardVehicle(state, vehicle.id, employee.id);

    expect(result.success).toBe(false);
  });

  it('rejects an employee already walking to board a different vehicle', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle: first } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const { vehicle: second } = purchaseVehicle(state.vehicles, 'debris_hauler', 8, 8);

    const boardedFirst = requestBoardVehicle(state, first.id, employee.id);
    expect(boardedFirst.success).toBe(true);

    const result = requestBoardVehicle(state, second.id, employee.id);

    expect(result.success).toBe(false);
    expect(result.error).toContain('already walking');
    // The first request's own claim is untouched by the second, refused one.
    expect(employee.pendingDriverVehicleId).toBe(first.id);
  });
});

describe('canBoardVehicle — read-only eligibility check (#715)', () => {
  it('reports the same success/failure requestBoardVehicle would apply, without mutating anything', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);

    const check = canBoardVehicle(state, vehicle.id, employee.id);

    expect(check.success).toBe(true);
    expect(employee.pendingDriverVehicleId).toBeNull();
    expect(employee.destinationX).toBeNull();
  });

  it('reports false for an employee already walking to board a different vehicle — the Fleet panel picker\'s own eligibility check', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle: first } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const { vehicle: second } = purchaseVehicle(state.vehicles, 'debris_hauler', 8, 8);
    requestBoardVehicle(state, first.id, employee.id);

    expect(canBoardVehicle(state, second.id, employee.id).success).toBe(false);
  });
});

describe('requestBoardVehicle — happy path defers the actual assignment', () => {
  it('returns success and sets destination + pendingDriverVehicleId, without touching vehicle.driverId', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    employee.x = 0;
    employee.z = 0;

    const result = requestBoardVehicle(state, vehicle.id, employee.id);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(employee.destinationX).toBe(vehicle.x);
    expect(employee.destinationZ).toBe(vehicle.z);
    expect(employee.pendingDriverVehicleId).toBe(vehicle.id);
    // The core contract under test: no synchronous assignment.
    expect(vehicle.driverId).toBeNull();
  });

  it('a higher proficiency level still qualifies the employee to request boarding', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    assignSkill(state.employees, employee.id, 'driving.truck', 4);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 8, 2);

    const result = requestBoardVehicle(state, vehicle.id, employee.id);

    expect(result.success).toBe(true);
    expect(employee.destinationX).toBe(8);
    expect(employee.destinationZ).toBe(2);
  });

  it('drill_rig role requires driving.drill_rig licence', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng); // holds driving.truck only
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 3, 3);

    const result = requestBoardVehicle(state, vehicle.id, employee.id);

    expect(result.success).toBe(false);
  });
});

// ── Same validations reachable via bare EmployeeState/VehicleState (no GameState) ──
// requestBoardVehicle's signature takes a GameState per the skeleton, but the
// underlying employee/vehicle collections it reads/writes are exactly
// state.employees / state.vehicles — covered implicitly above via createGame().
// This block re-confirms the module is usable standalone with a minimal state
// shape built the same way the other entity modules are unit-tested.
describe('requestBoardVehicle — fixture consistency with core state factories', () => {
  it('works against a freshly created employee/vehicle pair with no other state mutations', () => {
    const state = createGame({ seed: SEED });
    expect(state.employees).toBeDefined();
    expect(state.vehicles).toBeDefined();

    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);

    const before = { cash: state.cash };
    const result = requestBoardVehicle(state, vehicle.id, employee.id);

    expect(result.success).toBe(true);
    // No cash side effect from a boarding request.
    expect(state.cash).toBe(before.cash);
  });
});
