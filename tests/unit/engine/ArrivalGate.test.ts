// BlastSimulator2026 — Tests for ArrivalGate.tickArrivalGate (issue #437)
//
// ArrivalGate.ts is the single place that promotes pending* fields (set at
// claim time by tickEmployees / requestBoardVehicle / requestHaulFragment)
// into their live counterparts (restTicksRemaining, taskTicksRemaining,
// vehicle.driverId) — but only once the employee has actually arrived
// (destinationX === null && destinationZ === null).
//
// Training enrollment (enrolInTraining) is deliberately NOT arrival-gated:
// it relocates the employee to the school instantly rather than queuing a
// walk — see EmployeeTraining.ts and #410.

import { describe, it, expect } from 'vitest';
import { createGame, type PendingAction } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill, killEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { tickArrivalGate } from '../../../src/core/engine/ArrivalGate.js';
import { reconcileVehicleReservations } from '../../../src/core/engine/VehicleReservation.js';
// reconcileVehicleReservations no longer performs the interruption itself
// (import-cycle fix, #550) — it only reports which actions need it. Unit
// tests are allowed to import interruptActiveAction directly to perform the
// interruption the way ArrivalGate.tickArrivalGate now does.
import { interruptActiveAction } from '../../../src/core/engine/TaskDispatch.js';

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
  it('promotes pendingTaskDuration into taskTicksRemaining on arrival, clearing pendingTaskDuration but leaving pendingActionType/Payload for tickTaskProgress to consume at completion', () => {
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
    // pendingActionType/pendingActionPayload are consumed by tickTaskProgress
    // at actual completion (GameLoop.ts), not here — see survey resolution,
    // which needs to know what kind of task just finished.
    expect(employee.pendingActionType).toBe('survey');
    expect(employee.pendingActionPayload).toEqual({ method: 'core_sample', centerX: 16, centerZ: 16 });
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

// ── Issue #550: vehicle-gated actions — boarding sends the VEHICLE toward
// the action's target, and the work timer only starts once the vehicle
// itself (not the employee) arrives there. tickArrivalGate does not yet know
// about requiredVehicleRole/reservedForActionId at all — every test below is
// Red until it does.

function makeVehicleGatedAction(overrides: Partial<PendingAction> & { id: number }): PendingAction {
  return {
    type: 'general_work',
    requiredSkill: null,
    requiredVehicleRole: 'drill_rig',
    targetX: 0, targetZ: 0, targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'assigned',
    holderId: null,
    ...overrides,
  };
}

describe('tickArrivalGate — vehicle-gated boarding sends the vehicle, not the employee, toward the target (#550)', () => {
  it("sets the vehicle's destination to the action's target on boarding, leaving the employee's own destination null (aboard, not walking)", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);

    const action = makeVehicleGatedAction({ id: 1, holderId: employee.id, targetX: 20, targetZ: 20 });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    vehicle.reservedForActionId = action.id;

    employee.x = 5;
    employee.z = 5;
    employee.destinationX = null;
    employee.destinationZ = null;
    employee.pendingDriverVehicleId = vehicle.id;

    tickArrivalGate(state);

    expect(vehicle.driverId).toBe(employee.id);
    // The vehicle, not the employee, drives the rest of the way to the
    // action's own target — this is what #550 adds on top of plain boarding.
    expect(vehicle.targetX).toBe(20);
    expect(vehicle.targetZ).toBe(20);
    expect(employee.destinationX).toBeNull();
    expect(employee.destinationZ).toBeNull();
  });

  it('holds taskTicksRemaining at null while the vehicle is still driving toward the target, and only seeds it the tick the vehicle itself arrives', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 10, 10);
    vehicle.driverId = employee.id;
    vehicle.targetX = 20;
    vehicle.targetZ = 20;
    // Vehicle is mid-drive — not yet at its target.
    vehicle.x = 10;
    vehicle.z = 10;

    const action = makeVehicleGatedAction({ id: 2, holderId: employee.id, targetX: 20, targetZ: 20, status: 'in_progress' });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    vehicle.reservedForActionId = action.id;

    // Employee is aboard: no destination of their own, but a task is queued
    // and waiting for the vehicle's arrival to actually start.
    employee.x = vehicle.x;
    employee.z = vehicle.z;
    employee.destinationX = null;
    employee.destinationZ = null;
    employee.taskTicksRemaining = null;
    employee.pendingTaskDuration = 6;
    employee.activeTaskSkill = null;
    employee.pendingActionType = action.type;
    employee.pendingActionPayload = action.payload;

    tickArrivalGate(state);

    // Still driving — the work timer must not have started yet, even though
    // the employee's own destinationX/Z read as "arrived".
    expect(employee.taskTicksRemaining).toBeNull();
    expect(employee.pendingTaskDuration).toBe(6);

    // The vehicle itself now reaches the target.
    vehicle.x = 20;
    vehicle.z = 20;

    tickArrivalGate(state);

    expect(employee.taskTicksRemaining).toBe(6);
    expect(employee.pendingTaskDuration).toBeNull();
  });
});

describe('reconcileVehicleReservations — mid-drive holder death / vehicle destruction (#550)', () => {
  it('releases the reservation and dismounts the driver when the holder dies mid-drive', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 10, 10);
    vehicle.driverId = employee.id;
    vehicle.targetX = 20;
    vehicle.targetZ = 20;

    const action = makeVehicleGatedAction({ id: 3, holderId: employee.id, targetX: 20, targetZ: 20 });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    vehicle.reservedForActionId = action.id;
    employee.taskTicksRemaining = null;

    killEmployee(state.employees, employee.id);

    reconcileVehicleReservations(state);

    expect(vehicle.reservedForActionId).toBeNull();
    expect(vehicle.driverId).toBeNull();
  });

  it("interrupts (status back to 'queued') the employee's action when the reserved vehicle is destroyed mid-drive", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 10, 10);
    vehicle.driverId = employee.id;
    vehicle.targetX = 20;
    vehicle.targetZ = 20;

    const action = makeVehicleGatedAction({ id: 4, holderId: employee.id, targetX: 20, targetZ: 20 });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    vehicle.reservedForActionId = action.id;
    employee.taskTicksRemaining = null; // still travelling, not yet working

    // Vehicle destroyed underneath the employee — e.g. a blast projection.
    state.vehicles.vehicles = state.vehicles.vehicles.filter(v => v.id !== vehicle.id);

    const interruptions = reconcileVehicleReservations(state);

    // reconcileVehicleReservations itself is side-effect-free for this case —
    // it only reports the need to interrupt (import-cycle fix, #550). The
    // caller (ArrivalGate.tickArrivalGate) is the one that actually performs
    // it via interruptActiveAction; mirror that here.
    expect(interruptions).toEqual([{ employee, actionId: 4 }]);
    for (const { employee: emp, actionId } of interruptions) {
      interruptActiveAction(state, emp, actionId);
    }

    const reconciled = state.pendingActions.find(a => a.id === 4)!;
    expect(reconciled.status).toBe('queued');
    expect(reconciled.holderId).toBeNull();
    expect(employee.activeActionId).toBeNull();
  });
});
