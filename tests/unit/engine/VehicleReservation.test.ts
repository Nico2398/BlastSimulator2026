// BlastSimulator2026 — Tests for VehicleReservation.ts (issue #550)
//
// Owns the exclusive claim a vehicle-gated PendingAction holds on a Vehicle
// from the moment an employee claims it until the action completes, is
// cancelled, or the vehicle is destroyed underneath it. Red phase: every
// function in the module under test is still a `throw new Error('not
// implemented')` stub, so every test below is expected to fail.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill, killEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import {
  isLicensedForRole,
  findFreeVehicleForRole,
  reserveVehicle,
  releaseVehicleReservation,
  releaseVehicleOnCompletion,
  reconcileVehicleReservations,
} from '../../../src/core/engine/VehicleReservation.js';

const SEED = 42;

/** Minimal PendingAction fixture, mirroring GameLoop.test.ts's makeAction. */
function makeAction(state: GameState, overrides: Partial<PendingAction> & { id: number }): PendingAction {
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

describe('isLicensedForRole', () => {
  it('is true when the employee holds the role\'s required licence', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    expect(isLicensedForRole(employee, 'drill_rig')).toBe(true);
  });

  it('is false when the employee lacks the role\'s required licence', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    // Driller's only starting qualification is 'blasting', not 'driving.drill_rig'.

    expect(isLicensedForRole(employee, 'drill_rig')).toBe(false);
  });
});

describe('findFreeVehicleForRole', () => {
  it('picks a free licensed vehicle of the right role, ignoring wrong-role and broken vehicles', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    const { vehicle: wrongRole } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    const { vehicle: broken } = purchaseVehicle(state.vehicles, 'drill_rig', 1, 1);
    broken.state = 'broken';
    const { vehicle: free } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 2);

    const picked = findFreeVehicleForRole(state, 'drill_rig', employee);

    expect(picked).not.toBeNull();
    expect(picked!.id).toBe(free.id);
    expect(picked!.id).not.toBe(wrongRole.id);
    expect(picked!.id).not.toBe(broken.id);
  });

  it('picks the vehicle the employee is already driving over a lower-id free one (continuity tie-break)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    const { vehicle: lowerIdFree } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const { vehicle: alreadyDriving } = purchaseVehicle(state.vehicles, 'drill_rig', 1, 1);
    alreadyDriving.driverId = employee.id;
    expect(alreadyDriving.id).toBeGreaterThan(lowerIdFree.id);

    const picked = findFreeVehicleForRole(state, 'drill_rig', employee);

    expect(picked).not.toBeNull();
    expect(picked!.id).toBe(alreadyDriving.id);
  });

  it('returns null when the only matching vehicle is already reserved for another action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.reservedForActionId = 999;

    expect(findFreeVehicleForRole(state, 'drill_rig', employee)).toBeNull();
  });

  it('returns null when the employee lacks the role licence, even though a free vehicle exists', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    // No driving.drill_rig qualification assigned.
    purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    expect(findFreeVehicleForRole(state, 'drill_rig', employee)).toBeNull();
  });
});

describe('reserveVehicle', () => {
  it('sets reservedForActionId on the vehicle', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    reserveVehicle(vehicle, 42);

    expect(vehicle.reservedForActionId).toBe(42);
  });

  it('overwrites a previous reservation on the same vehicle object (boundary: re-reservation)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.reservedForActionId = 7;

    reserveVehicle(vehicle, 99);

    expect(vehicle.reservedForActionId).toBe(99);
  });
});

describe('releaseVehicleReservation', () => {
  it('clears reservedForActionId and unassigns a boarded driver, resetting task/state to idle', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.reservedForActionId = 5;
    vehicle.driverId = employee.id;
    vehicle.task = 'drilling';
    vehicle.state = 'working';

    releaseVehicleReservation(state, 5);

    expect(vehicle.reservedForActionId).toBeNull();
    expect(vehicle.driverId).toBeNull();
    expect(vehicle.task).toBe('idle');
    expect(vehicle.state).toBe('idle');
  });

  it('is a no-op when no vehicle is reserved for the given actionId', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.reservedForActionId = null;

    expect(() => releaseVehicleReservation(state, 123)).not.toThrow();
    expect(vehicle.reservedForActionId).toBeNull();
    expect(vehicle.driverId).toBeNull();
  });
});

describe('releaseVehicleOnCompletion', () => {
  it('dismounts the driver and frees the vehicle when reservedForActionId still matches the completed action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.driverId = employee.id;
    vehicle.reservedForActionId = 7;

    releaseVehicleOnCompletion(state, employee, 7);

    expect(vehicle.driverId).toBeNull();
    expect(vehicle.reservedForActionId).toBeNull();
  });

  it('leaves driver and reservation untouched when a same-role follow-up already reserved the vehicle for a different action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.driverId = employee.id;
    vehicle.reservedForActionId = 8; // follow-up action, not the one that just completed

    releaseVehicleOnCompletion(state, employee, 7);

    expect(vehicle.driverId).toBe(employee.id);
    expect(vehicle.reservedForActionId).toBe(8);
  });
});

describe('reconcileVehicleReservations', () => {
  it('releases a reservation whose PendingAction id no longer exists in state.pendingActions', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.reservedForActionId = 99;
    vehicle.driverId = employee.id;
    // No PendingAction with id 99 exists — orphaned reservation.

    reconcileVehicleReservations(state);

    expect(vehicle.reservedForActionId).toBeNull();
    expect(vehicle.driverId).toBeNull();
  });

  it('releases and dismounts when the reservation holder is dead', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const action = makeAction(state, { id: 10, holderId: employee.id, status: 'assigned' });
    state.pendingActions.push(action);
    employee.activeActionId = 10;
    vehicle.reservedForActionId = 10;
    vehicle.driverId = employee.id;

    killEmployee(state.employees, employee.id);
    reconcileVehicleReservations(state);

    expect(vehicle.reservedForActionId).toBeNull();
    expect(vehicle.driverId).toBeNull();
  });

  it("interrupts (status back to 'queued') an employee whose reserved vehicle no longer exists, while still travelling (taskTicksRemaining null)", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const action = makeAction(state, { id: 20, holderId: employee.id, status: 'assigned', targetX: 10, targetZ: 10 });
    state.pendingActions.push(action);
    employee.activeActionId = 20;
    vehicle.reservedForActionId = 20;
    vehicle.driverId = employee.id;
    employee.taskTicksRemaining = null;

    // Vehicle destroyed underneath the employee mid-drive.
    state.vehicles.vehicles = state.vehicles.vehicles.filter(v => v.id !== vehicle.id);

    reconcileVehicleReservations(state);

    const reconciled = state.pendingActions.find(a => a.id === 20)!;
    expect(reconciled.status).toBe('queued');
    expect(reconciled.holderId).toBeNull();
    expect(employee.activeActionId).toBeNull();
  });

  it('never touches an employee already mid-work-timer (taskTicksRemaining non-null), even if the vehicle is gone', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const action = makeAction(state, { id: 21, holderId: employee.id, status: 'in_progress', targetX: 10, targetZ: 10 });
    state.pendingActions.push(action);
    employee.activeActionId = 21;
    vehicle.reservedForActionId = 21;
    vehicle.driverId = employee.id;
    employee.taskTicksRemaining = 5; // already working — vehicle physically arrived

    state.vehicles.vehicles = state.vehicles.vehicles.filter(v => v.id !== vehicle.id);

    reconcileVehicleReservations(state);

    const untouched = state.pendingActions.find(a => a.id === 21)!;
    expect(untouched.status).toBe('in_progress');
    expect(untouched.holderId).toBe(employee.id);
    expect(employee.activeActionId).toBe(21);
    expect(employee.taskTicksRemaining).toBe(5);
  });
});
