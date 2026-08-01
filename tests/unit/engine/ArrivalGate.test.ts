// BlastSimulator2026 — Tests for ArrivalGate.tickArrivalGate (issue #437)
//
// ArrivalGate.ts is the single place that promotes pending* fields (set at
// claim time by tickEmployees / requestBoardVehicle / requestHaulFragment /
// enrolInTraining) into their live counterparts (restTicksRemaining,
// taskTicksRemaining, vehicle.driverId) — but only once the employee has
// actually arrived (destinationX === null && destinationZ === null).
//
// RED PHASE: src/core/engine/ArrivalGate.ts's tickArrivalGate always throws
// 'not implemented'. Every test below therefore fails until the implementer
// fills in the real gating logic.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { tickArrivalGate } from '../../../src/core/engine/ArrivalGate.js';

const SEED = 42;

describe('tickArrivalGate — mid-transit employees are untouched', () => {
  it('does not promote a pending rest while the employee is still walking (destinationX/Z non-null)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.destinationX = 10;
    employee.destinationZ = 10;
    employee.pendingRestDuration = 5;
    employee.pendingRestNeedKey = 'hunger';

    const result = tickArrivalGate(state);

    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.restNeedKey).toBeNull();
    expect(employee.pendingRestDuration).toBe(5);
    expect(employee.pendingRestNeedKey).toBe('hunger');
    expect(result.restStarted).toEqual([]);
  });

  it('does not promote a pending task while only one axis of the destination is still set', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'surveyor', rng);
    employee.x = 3;
    employee.z = 3;
    employee.destinationX = null;
    employee.destinationZ = 3; // still travelling on Z — not yet arrived
    employee.pendingTaskDuration = 4;
    employee.pendingActionType = 'survey';
    employee.pendingActionPayload = { method: 'core_sample' };

    const result = tickArrivalGate(state);

    expect(employee.taskTicksRemaining).toBeNull();
    expect(employee.pendingTaskDuration).toBe(4);
    expect(result.taskStarted).toEqual([]);
  });

  it('does not board a vehicle while the employee is still travelling toward it', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    employee.x = 0;
    employee.z = 0;
    employee.destinationX = 5;
    employee.destinationZ = 5;
    employee.pendingDriverVehicleId = vehicle.id;

    const result = tickArrivalGate(state);

    expect(vehicle.driverId).toBeNull();
    expect(employee.pendingDriverVehicleId).toBe(vehicle.id);
    expect(result.driversBoarded).toEqual([]);
    expect(result.boardingCancelled).toEqual([]);
  });
});

describe('tickArrivalGate — rest arrival', () => {
  it('promotes pendingRestDuration into restTicksRemaining/restNeedKey on arrival, clearing the pending fields', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 8;
    employee.z = 8;
    employee.destinationX = null;
    employee.destinationZ = null;
    employee.pendingRestDuration = 6;
    employee.pendingRestNeedKey = 'fatigue';

    const result = tickArrivalGate(state);

    expect(employee.restTicksRemaining).toBe(6);
    expect(employee.restNeedKey).toBe('fatigue');
    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.pendingRestNeedKey).toBeNull();
    expect(result.restStarted).toEqual([employee.id]);
  });

  it('is a no-op for an arrived employee with no pending rest', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 8;
    employee.z = 8;
    employee.destinationX = null;
    employee.destinationZ = null;

    const result = tickArrivalGate(state);

    expect(employee.restTicksRemaining).toBeNull();
    expect(result.restStarted).toEqual([]);
  });
});

describe('tickArrivalGate — task arrival', () => {
  it('promotes pendingTaskDuration into taskTicksRemaining on arrival, clearing pending fields', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'surveyor', rng);
    employee.x = 16;
    employee.z = 16;
    employee.destinationX = null;
    employee.destinationZ = null;
    employee.pendingTaskDuration = 4;
    employee.pendingActionType = 'survey';
    employee.pendingActionPayload = { method: 'core_sample', centerX: 16, centerZ: 16 };

    const result = tickArrivalGate(state);

    expect(employee.taskTicksRemaining).toBe(4);
    expect(employee.pendingTaskDuration).toBeNull();
    expect(employee.pendingActionType).toBeNull();
    expect(employee.pendingActionPayload).toBeNull();
    expect(result.taskStarted).toEqual([employee.id]);
  });

  it('is a no-op for an arrived employee with no pending task', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'surveyor', rng);
    employee.x = 16;
    employee.z = 16;
    employee.destinationX = null;
    employee.destinationZ = null;

    const result = tickArrivalGate(state);

    expect(employee.taskTicksRemaining).toBeNull();
    expect(result.taskStarted).toEqual([]);
  });
});

describe('tickArrivalGate — vehicle boarding', () => {
  it('assigns the driver once the employee has arrived at a still-driverless, still-in-place vehicle', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    employee.x = 5;
    employee.z = 5;
    employee.destinationX = null;
    employee.destinationZ = null;
    employee.pendingDriverVehicleId = vehicle.id;

    const emitter = new EventEmitter();
    const boardedEvents: Array<{ employeeId: number; vehicleId: number }> = [];
    emitter.on('vehicle:driver_boarded', (data) => boardedEvents.push(data));

    const result = tickArrivalGate(state, emitter);

    expect(vehicle.driverId).toBe(employee.id);
    expect(employee.pendingDriverVehicleId).toBeNull();
    expect(result.driversBoarded).toEqual([employee.id]);
    expect(boardedEvents).toEqual([{ employeeId: employee.id, vehicleId: vehicle.id }]);
  });

  it('cancels the boarding with reason "vehicle_gone" when the vehicle was destroyed en route', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const goneId = vehicle.id;
    state.vehicles.vehicles = state.vehicles.vehicles.filter(v => v.id !== goneId);

    employee.x = 5;
    employee.z = 5;
    employee.destinationX = null;
    employee.destinationZ = null;
    employee.pendingDriverVehicleId = goneId;

    const result = tickArrivalGate(state);

    expect(employee.pendingDriverVehicleId).toBeNull();
    expect(result.driversBoarded).toEqual([]);
    expect(result.boardingCancelled).toEqual([{ employeeId: employee.id, reason: 'vehicle_gone' }]);
  });

  it('cancels the boarding with reason "vehicle_taken" when another driver claimed the vehicle first', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { employee: otherDriver } = hireEmployee(state.employees, 'driver', new Random(SEED + 1));
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    vehicle.driverId = otherDriver.id;

    employee.x = 5;
    employee.z = 5;
    employee.destinationX = null;
    employee.destinationZ = null;
    employee.pendingDriverVehicleId = vehicle.id;

    const result = tickArrivalGate(state);

    expect(vehicle.driverId).toBe(otherDriver.id);
    expect(employee.pendingDriverVehicleId).toBeNull();
    expect(result.driversBoarded).toEqual([]);
    expect(result.boardingCancelled).toEqual([{ employeeId: employee.id, reason: 'vehicle_taken' }]);
  });

  it('cancels the boarding with reason "vehicle_moved" when the vehicle is no longer where the employee arrived', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    // Vehicle drove off before the employee finished walking to its old spot.
    vehicle.x = 40;
    vehicle.z = 40;

    employee.x = 5;
    employee.z = 5;
    employee.destinationX = null;
    employee.destinationZ = null;
    employee.pendingDriverVehicleId = vehicle.id;

    const result = tickArrivalGate(state);

    expect(vehicle.driverId).toBeNull();
    expect(employee.pendingDriverVehicleId).toBeNull();
    expect(result.driversBoarded).toEqual([]);
    expect(result.boardingCancelled).toEqual([{ employeeId: employee.id, reason: 'vehicle_moved' }]);
  });
});

describe('tickArrivalGate — dead employees are skipped entirely', () => {
  it('does nothing for a dead employee even with pending rest/task/boarding set', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    employee.alive = false;
    employee.x = 5;
    employee.z = 5;
    employee.destinationX = null;
    employee.destinationZ = null;
    employee.pendingRestDuration = 3;
    employee.pendingRestNeedKey = 'hunger';
    employee.pendingTaskDuration = 4;
    employee.pendingDriverVehicleId = vehicle.id;

    const result = tickArrivalGate(state);

    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.taskTicksRemaining).toBeNull();
    expect(vehicle.driverId).toBeNull();
    expect(employee.pendingRestDuration).toBe(3);
    expect(employee.pendingTaskDuration).toBe(4);
    expect(employee.pendingDriverVehicleId).toBe(vehicle.id);
    expect(result.restStarted).toEqual([]);
    expect(result.taskStarted).toEqual([]);
    expect(result.driversBoarded).toEqual([]);
    expect(result.boardingCancelled).toEqual([]);
  });
});

describe('tickArrivalGate — combined multi-employee tick', () => {
  it('processes rest, task, and boarding promotions for different employees in the same tick', () => {
    const state = createGame({ seed: SEED });
    const { employee: resting } = hireEmployee(state.employees, 'driller', new Random(SEED));
    const { employee: tasked } = hireEmployee(state.employees, 'surveyor', new Random(SEED + 1));
    const { employee: driver } = hireEmployee(state.employees, 'driver', new Random(SEED + 2));
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 9, 9);

    resting.x = 1; resting.z = 1;
    resting.destinationX = null; resting.destinationZ = null;
    resting.pendingRestDuration = 2;
    resting.pendingRestNeedKey = 'hunger';

    tasked.x = 2; tasked.z = 2;
    tasked.destinationX = null; tasked.destinationZ = null;
    tasked.pendingTaskDuration = 3;
    tasked.pendingActionType = 'survey';
    tasked.pendingActionPayload = { method: 'aerial' };

    driver.x = 9; driver.z = 9;
    driver.destinationX = null; driver.destinationZ = null;
    driver.pendingDriverVehicleId = vehicle.id;

    const result = tickArrivalGate(state);

    expect(result.restStarted).toEqual([resting.id]);
    expect(result.taskStarted).toEqual([tasked.id]);
    expect(result.driversBoarded).toEqual([driver.id]);
    expect(resting.restTicksRemaining).toBe(2);
    expect(tasked.taskTicksRemaining).toBe(3);
    expect(vehicle.driverId).toBe(driver.id);
  });
});
