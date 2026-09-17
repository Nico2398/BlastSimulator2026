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
import { purchaseVehicle, ROLE_LICENCE_REQUIRED, vehicleDriverId } from '../../../src/core/entities/Vehicle.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { tickArrivalGate } from '../../../src/core/engine/ArrivalGate.js';
// #1089: boarding itself, and a vehicle-gated action's own drive, now resolve
// entirely inside tickLocomotion's own itinerary walk (Locomotion.ts) rather
// than in a dedicated vehicle-drive loop here — ArrivalGate.ts's own
// driversBoarded/boardingCancelled result fields are kept on the shape but
// always empty now (see that file's own doc comments). Every test below that
// used to poke pendingDriverVehicleId/vehicle.driverId/vehicle.targetX/Z
// directly and call tickArrivalGate alone now drives the same scenario
// through moveTo (real itinerary) + tickLocomotion (the real mover) instead.
import { moveTo } from '../../../src/core/engine/MoveTo.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';
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
    employee.pendingRestNeedKey = 'fatigue';

    const result = tickArrivalGate(state);

    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.restNeedKey).toBeNull();
    expect(employee.pendingRestDuration).toBe(5);
    expect(employee.pendingRestNeedKey).toBe('fatigue');
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

    expect(vehicleDriverId(vehicle)).toBeNull();
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
    // at actual completion (TaskProgress.ts), not here — see survey resolution,
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

describe('tickArrivalGate — vehicle boarding (boarding itself now resolves in tickLocomotion, #1089)', () => {
  it('assigns the driver once the employee has arrived at a still-driverless, still-in-place vehicle', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    employee.x = 5;
    employee.z = 5;

    const emitter = new EventEmitter();
    const boardedEvents: Array<{ employeeId: number; vehicleId: number }> = [];
    emitter.on('vehicle:driver_boarded', (data) => boardedEvents.push(data));

    const moveResult = moveTo(state, employee.id, { vehicleId: vehicle.id });
    expect(moveResult.success).toBe(true);
    tickLocomotion(state, emitter);

    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(employee.pendingDriverVehicleId).toBeNull();
    expect(boardedEvents).toEqual([{ employeeId: employee.id, vehicleId: vehicle.id }]);
  });

  it('refuses to plan a board (moveTo returns success:false) for a vehicle that no longer exists', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const goneId = vehicle.id;
    state.vehicles.vehicles = state.vehicles.vehicles.filter(v => v.id !== goneId);

    employee.x = 5;
    employee.z = 5;

    const moveResult = moveTo(state, employee.id, { vehicleId: goneId });

    expect(moveResult.success).toBe(false);
    expect(employee.pendingDriverVehicleId).toBeNull();
  });

  it('refuses to plan a board (moveTo returns success:false) when another driver already claimed the vehicle', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { employee: otherDriver } = hireEmployee(state.employees, 'driver', new Random(SEED + 1));
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    vehicle.occupantIds = [otherDriver.id];
    otherDriver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    employee.x = 5;
    employee.z = 5;

    const moveResult = moveTo(state, employee.id, { vehicleId: vehicle.id });

    expect(moveResult.success).toBe(false);
    expect(vehicleDriverId(vehicle)).toBe(otherDriver.id);
    expect(employee.pendingDriverVehicleId).toBeNull();
  });

  it('cancels the boarding (board arrival step fails) when the vehicle drove off before the employee\'s walk finished', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    employee.x = 5;
    employee.z = 5;

    const moveResult = moveTo(state, employee.id, { vehicleId: vehicle.id });
    expect(moveResult.success).toBe(true);

    // Vehicle drove off before the employee's (already-arrived, adjacent)
    // board step resolves — mirrors the old "vehicle_moved" cancellation.
    vehicle.x = 40;
    vehicle.z = 40;

    tickLocomotion(state);

    expect(vehicleDriverId(vehicle)).toBeNull();
    expect(employee.itinerary).toBeNull();
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
  });
});

describe('tickArrivalGate — driverBoardingCount (issue #1083)', () => {
  it('increments state.vehicles.driverBoardingCount by exactly 1 on a successful boarding', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    employee.x = 5;
    employee.z = 5;

    expect(state.vehicles.driverBoardingCount).toBe(0);

    const moveResult = moveTo(state, employee.id, { vehicleId: vehicle.id });
    expect(moveResult.success).toBe(true);
    tickLocomotion(state);

    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(state.vehicles.driverBoardingCount).toBe(1);
  });

  it('does not increment driverBoardingCount when moveTo itself refuses the board (vehicle already gone)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const goneId = vehicle.id;
    state.vehicles.vehicles = state.vehicles.vehicles.filter(v => v.id !== goneId);

    employee.x = 5;
    employee.z = 5;

    expect(state.vehicles.driverBoardingCount).toBe(0);

    const moveResult = moveTo(state, employee.id, { vehicleId: goneId });

    expect(moveResult.success).toBe(false);
    expect(state.vehicles.driverBoardingCount).toBe(0);
  });
});

// #1092: an evacuation rescue is one itinerary — walk to the vehicle, board
// it, drive it clear, step off — rather than a board whose arrival step read
// a `pendingEvacuationDestination` marker off the vehicle and issued a second
// moveTo. Nothing is staged on the vehicle at all any more, so what these
// cover is the itinerary surviving (or being abandoned) across the board.
describe('tickArrivalGate — evacuation-drive boarding (#1042, one itinerary since #1092)', () => {
  it('keeps driving toward the safe cell once boarding resolves, for a vehicle not reserved for any action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    expect(vehicle.reservedForActionId).toBeNull();

    employee.x = 5;
    employee.z = 5;

    // `via` is what clearZone (Zone.ts) plans the rescue with: one itinerary
    // routing the driver through the vehicle to the safe cell.
    const moveResult = moveTo(state, employee.id, { x: 40, z: 40 }, { via: vehicle.id });
    expect(moveResult.success).toBe(true);

    tickLocomotion(state);
    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    tickLocomotion(state);

    expect(vehicle.targetX).toBe(40);
    expect(vehicle.targetZ).toBe(40);
  });

  it('abandons the rescue itinerary when the boarding is cancelled because another driver took the vehicle first', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { employee: otherDriver } = hireEmployee(state.employees, 'driver', new Random(SEED + 1));
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);

    employee.x = 5;
    employee.z = 5;

    // Plans successfully — the vehicle is still free at plan time.
    const moveResult = moveTo(state, employee.id, { x: 40, z: 40 }, { via: vehicle.id });
    expect(moveResult.success).toBe(true);

    // Another driver claims the vehicle in the same tick, before this
    // employee's own (already-adjacent) board arrival step resolves.
    vehicle.occupantIds = [otherDriver.id];
    otherDriver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    tickLocomotion(state);

    expect(vehicleDriverId(vehicle)).toBe(otherDriver.id);
    expect(employee.itinerary).toBeNull();
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
  });

  it('abandons the rescue itinerary when the boarding is cancelled because the vehicle moved away first', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);

    employee.x = 5;
    employee.z = 5;

    const moveResult = moveTo(state, employee.id, { x: 60, z: 60 }, { via: vehicle.id });
    expect(moveResult.success).toBe(true);

    // Vehicle drove off before the employee's (already-arrived, adjacent)
    // board step resolves.
    vehicle.x = 40;
    vehicle.z = 40;

    tickLocomotion(state);

    expect(vehicleDriverId(vehicle)).toBeNull();
    expect(employee.itinerary).toBeNull();
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
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
    employee.pendingRestNeedKey = 'fatigue';
    employee.pendingTaskDuration = 4;
    employee.pendingDriverVehicleId = vehicle.id;

    const result = tickArrivalGate(state);

    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.taskTicksRemaining).toBeNull();
    expect(vehicleDriverId(vehicle)).toBeNull();
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
    resting.pendingRestNeedKey = 'fatigue';

    tasked.x = 2; tasked.z = 2;
    tasked.destinationX = null; tasked.destinationZ = null;
    tasked.pendingTaskDuration = 3;
    tasked.pendingActionType = 'survey';
    tasked.pendingActionPayload = { method: 'aerial' };

    driver.x = 9; driver.z = 9;
    // #1089: boarding resolves in tickLocomotion, not tickArrivalGate — plan
    // the drive's real itinerary first.
    const moveResult = moveTo(state, driver.id, { vehicleId: vehicle.id });
    expect(moveResult.success).toBe(true);
    tickLocomotion(state);

    const result = tickArrivalGate(state);

    expect(result.restStarted).toEqual([resting.id]);
    expect(result.taskStarted).toEqual([tasked.id]);
    expect(resting.restTicksRemaining).toBe(2);
    expect(tasked.taskTicksRemaining).toBe(3);
    expect(vehicleDriverId(vehicle)).toBe(driver.id);
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
    queuedAtTick: 0,
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

    // #1089: promoteVehicleGatedAction's own real call — moveTo(via:
    // vehicle) — builds the board-then-drive itinerary; tickLocomotion is
    // what actually walks it (boarding itself no longer resolves in
    // tickArrivalGate).
    const moveResult = moveTo(state, employee.id, { x: action.targetX, z: action.targetZ }, { via: vehicle.id });
    expect(moveResult.success).toBe(true);
    tickLocomotion(state);

    expect(vehicleDriverId(vehicle)).toBe(employee.id);
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

    const action = makeVehicleGatedAction({ id: 2, holderId: employee.id, targetX: 20, targetZ: 20, status: 'assigned' });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    vehicle.reservedForActionId = action.id;
    employee.x = 10;
    employee.z = 10;

    // #1089: VehicleReservation.promoteVehicleGatedAction's own doc comment —
    // a vehicle-gated action never stages pendingTaskDuration/
    // taskTicksRemaining at claim time; ArrivalGate.tickArrivalGate seeds it
    // itself, once the employee (and, by I2, their vehicle) actually reaches
    // the target.
    const moveResult = moveTo(state, employee.id, { x: action.targetX, z: action.targetZ }, { via: vehicle.id });
    expect(moveResult.success).toBe(true);
    tickLocomotion(state); // boards + starts the drive
    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    tickArrivalGate(state);

    // Still driving — the work timer must not have started yet.
    expect(employee.taskTicksRemaining).toBeNull();

    // Drive the rest of the way to the target.
    for (let i = 0; i < 50 && (vehicle.x !== 20 || vehicle.z !== 20); i++) {
      tickLocomotion(state);
    }
    expect(vehicle.x).toBe(20);
    expect(vehicle.z).toBe(20);

    tickArrivalGate(state);

    expect(employee.taskTicksRemaining).not.toBeNull();
    expect(employee.pendingTaskDuration).toBeNull();
  });
});

describe('tickArrivalGate — stale-claim guard on vehicle arrival (#928)', () => {
  it("releases the action to the open pool instead of promoting it, when the holder's own activeActionId no longer names it", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 20, 20);
    vehicle.occupantIds = [employee.id];
    vehicle.targetX = 20;
    vehicle.targetZ = 20;
    // The vehicle has already arrived at the action's target this tick.
    vehicle.x = 20;
    vehicle.z = 20;

    const action = makeVehicleGatedAction({
      id: 3, holderId: employee.id, targetX: 20, targetZ: 20, status: 'in_progress',
    });
    state.pendingActions.push(action);
    vehicle.reservedForActionId = action.id;

    // The holder has since moved on — e.g. sent to rest — so activeActionId
    // no longer names this action, even though the vehicle (driven on its
    // own steam by this loop) still reached the target.
    employee.x = 20;
    employee.z = 20;
    employee.activeActionId = null;
    employee.restTicksRemaining = 5;
    employee.taskTicksRemaining = null;
    employee.pendingTaskDuration = null;

    tickArrivalGate(state);

    // Stale claim released back to the open pool, not promoted.
    expect(action.status).toBe('queued');
    expect(action.holderId).toBeNull();
    expect(employee.taskTicksRemaining).toBeNull();
    // The employee's own, unrelated rest is untouched.
    expect(employee.restTicksRemaining).toBe(5);
  });
});

// ── issue #922: a driver's position tracks the vehicle continuously, every
// tick of the drive — not just once at the end (arrival) or at dismount.
// tickArrivalGate's own vehicle-drive loop is the one place a boarded,
// reserved vehicle's x/z is advanced (tickVehicle), so this is the level
// that proves the fix reaches the full vehicle-gated drive, not just a bare
// tickVehicle call.

describe("tickArrivalGate — a driver's x/z tracks the vehicle continuously across a multi-tick drive (#922)", () => {
  it('updates employee.x/z to match the vehicle on every single tick of the drive, not only at arrival', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    const action = makeVehicleGatedAction({ id: 5, holderId: employee.id, targetX: 20, targetZ: 0, status: 'assigned' });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    vehicle.reservedForActionId = action.id;
    employee.x = 0;
    employee.z = 0;

    // #1089: only an employee moves — tickLocomotion (not tickArrivalGate)
    // is the real per-tick mover now; I2 (WorldInvariants.ts) is what
    // guarantees the driver's own x/z always equals their vehicle's.
    const moveResult = moveTo(state, employee.id, { x: action.targetX, z: action.targetZ }, { via: vehicle.id });
    expect(moveResult.success).toBe(true);

    let sawEmployeeOffOriginalBoardingCell = false;
    for (let i = 0; i < 15 && (vehicle.x !== action.targetX || vehicle.z !== action.targetZ); i++) {
      tickLocomotion(state);
      // The driver must track the vehicle exactly, every single tick —
      // never lag a tick behind and never stay frozen at the boarding cell
      // while the vehicle drives on ahead of them.
      expect(employee.x).toBe(vehicle.x);
      expect(employee.z).toBe(vehicle.z);
      if (employee.x !== 0) sawEmployeeOffOriginalBoardingCell = true;
    }

    // The drive actually covered ground — otherwise the "every tick" check
    // above would trivially hold without ever exercising it.
    expect(sawEmployeeOffOriginalBoardingCell).toBe(true);
  });
});

describe('reconcileVehicleReservations — mid-drive holder death / vehicle destruction (#550)', () => {
  it('releases the reservation and dismounts the driver when the holder dies mid-drive', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 10, 10);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
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
    expect(vehicleDriverId(vehicle)).toBeNull();
  });

  it("interrupts (status back to 'queued') the employee's action when the reserved vehicle is destroyed mid-drive", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 10, 10);
    vehicle.occupantIds = [employee.id];
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
