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
  isMidVehicleGatedWork,
} from '../../../src/core/engine/VehicleReservation.js';
// reconcileVehicleReservations no longer performs the interruption itself
// (import-cycle fix, #550) — it only reports which actions need it. Unit
// tests are allowed to import interruptActiveAction directly to perform the
// interruption the way ArrivalGate.tickArrivalGate now does, so the
// end-to-end effect can still be asserted at this level.
import { interruptActiveAction } from '../../../src/core/engine/TaskDispatch.js';
// #922: real call chains that release a vehicle-gated reservation mid-drive
// — cancellation and forced shift rest — both eventually call
// releaseVehicleReservation above, but the tests below drive them through
// their actual entry points rather than calling it directly, so a future
// regression in either chain (e.g. skipping the release, or snapping to a
// stale position) is caught here too.
import { cancelAction } from '../../../src/core/engine/TaskCancellation.js';
import { forceShiftRestIfNeeded } from '../../../src/core/engine/ForceShiftRest.js';
import { tickVehicle } from '../../../src/core/engine/EntityMovementTick.js';
import { WORK_DURATION_TICKS } from '../../../src/core/config/balance.js';

const SEED = 42;

/** Minimal PendingAction fixture, mirroring EmployeeDispatch.test.ts's makeAction. */
function makeAction(_state: GameState, overrides: Partial<PendingAction> & { id: number }): PendingAction {
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

// ── issue #922: dismount always lands at the vehicle's CURRENT cell, never
// the boarding cell — traced through the real call chains a player actually
// triggers (cancellation, forced shift rest), not just releaseVehicleReservation
// called directly. Drives the vehicle several cells with the real tickVehicle
// stepper first, so "the vehicle has moved since boarding" is genuine.

/** Vehicle-gated PendingAction fixture matching makeAction, with a fixed holder. */
function makeVehicleGatedHeldAction(id: number, holderId: number): PendingAction {
  return makeAction({} as GameState, {
    id, holderId, status: 'in_progress', targetX: 30, targetZ: 0, requiredVehicleRole: 'drill_rig',
  });
}

describe("releaseVehicleReservation's real call chains land the driver at the vehicle's current cell, not the boarding cell (#922)", () => {
  it('cancelAction (TaskCancellation.ts) snaps the driver to where the vehicle now sits after several cells of real driving', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.driverId = employee.id;
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 30;
    vehicle.targetZ = 0;

    const action = makeVehicleGatedHeldAction(30, employee.id);
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    vehicle.reservedForActionId = action.id;
    employee.x = 0;
    employee.z = 0;

    // Real driving — several cells, no NavGrid (state.navGrid is null on a
    // freshly-created game), so tickVehicleDirectLine advances one cell/tick.
    for (let i = 0; i < 5; i++) tickVehicle(state, vehicle);
    expect(vehicle.x).toBeGreaterThan(0); // sanity: it actually moved

    const vehicleXAtCancel = vehicle.x;
    const vehicleZAtCancel = vehicle.z;

    const result = cancelAction(state, action.id);

    expect(result.success).toBe(true);
    expect(vehicle.driverId).toBeNull();
    expect(employee.x).toBe(vehicleXAtCancel);
    expect(employee.z).toBe(vehicleZAtCancel);
    // Never the original boarding cell — the vehicle demonstrably moved.
    expect(employee.x).not.toBe(0);
  });

  it('forceShiftRestIfNeeded (ForceShiftRest.ts) snaps the driver to where the vehicle now sits, not the boarding cell', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.driverId = employee.id;
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 30;
    vehicle.targetZ = 0;

    const action = makeVehicleGatedHeldAction(31, employee.id);
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    vehicle.reservedForActionId = action.id;
    employee.x = 0;
    employee.z = 0;

    for (let i = 0; i < 5; i++) tickVehicle(state, vehicle);
    expect(vehicle.x).toBeGreaterThan(0);

    const vehicleXAtRest = vehicle.x;
    const vehicleZAtRest = vehicle.z;

    employee.ticksWorked = WORK_DURATION_TICKS;
    forceShiftRestIfNeeded(state, employee, [], []);

    expect(vehicle.driverId).toBeNull();
    expect(employee.x).toBe(vehicleXAtRest);
    expect(employee.z).toBe(vehicleZAtRest);
    expect(employee.x).not.toBe(0);
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

    const interruptions = reconcileVehicleReservations(state);

    // reconcileVehicleReservations itself is side-effect-free for this case —
    // it only reports the need to interrupt (import-cycle fix, #550). The
    // caller (ArrivalGate.tickArrivalGate) is the one that actually performs
    // it via interruptActiveAction; mirror that here.
    expect(interruptions).toEqual([{ employee, actionId: 20 }]);
    for (const { employee: emp, actionId } of interruptions) {
      interruptActiveAction(state, emp, actionId);
    }

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

// #945 follow-up: isMidVehicleGatedWork previously had no dedicated unit
// coverage of its own — only indirectly exercised via ForceShiftRest.test.ts's
// policy-guard cases, which only reached its true-branch and the
// requiredVehicleRole === null false-branch. Direct coverage here for every
// branch, including the three TaskCancellation.ts's own #945 follow-up
// (mid-drive interrupt pinning) now also depends on.
describe('isMidVehicleGatedWork', () => {
  it('is true when the employee is the boarded driver of the vehicle reserved for their own active, vehicle-gated action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const action = makeAction(state, { id: 1, holderId: employee.id, status: 'in_progress' });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    vehicle.reservedForActionId = action.id;
    vehicle.driverId = employee.id;

    expect(isMidVehicleGatedWork(state, employee)).toBe(true);
  });

  it('is false when the employee has no active action (boundary: activeActionId null)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = null;

    expect(isMidVehicleGatedWork(state, employee)).toBe(false);
  });

  it('is false when the active action id no longer names any PendingAction', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 999; // no matching entry in state.pendingActions

    expect(isMidVehicleGatedWork(state, employee)).toBe(false);
  });

  it('is false when the active action requires no vehicle role', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const action = makeAction(state, { id: 2, holderId: employee.id, status: 'in_progress', requiredVehicleRole: null });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;

    expect(isMidVehicleGatedWork(state, employee)).toBe(false);
  });

  it("is false when the vehicle reserved for the action is driven by someone else (rejection: driverId mismatch)", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { employee: otherDriver } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const action = makeAction(state, { id: 3, holderId: employee.id, status: 'in_progress' });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    vehicle.reservedForActionId = action.id;
    vehicle.driverId = otherDriver.id; // reservation exists, but this employee never boarded it

    expect(isMidVehicleGatedWork(state, employee)).toBe(false);
  });
});
