// BlastSimulator2026 — Direct unit tests for EmployeeDispatchSteps.ts's
// per-employee claim/promote steps (#813). These functions were promoted
// from module-private to `export function` purely so GameLoop.ts's #759
// split could call them across files — behavior is unchanged from before the
// split (already exercised indirectly via tickEmployees in
// EmployeeDispatch.test.ts) — this file is the mirrored-path direct coverage
// core-purity.md requires for every exported src/core/ function.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import {
  claimActionsTargetedAtEmployee,
  fillIdleEmployeeFromQueueOrPool,
  claimOnePoolCandidate,
  reserveOnePoolActionAhead,
  promoteActionToActive,
  type TickEmployeesResult,
} from '../../../src/core/engine/EmployeeDispatchSteps.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { MAX_EMPLOYEE_TASK_QUEUE_DEPTH, NEED_REST_DURATIONS } from '../../../src/core/config/balance.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';

const SEED = 42;

function makeAction(overrides: Partial<PendingAction> & { id: number }): PendingAction {
  return {
    type: 'general_work',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: 0, targetZ: 0, targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'queued',
    holderId: null,
    ...overrides,
  };
}

function makeResult(): TickEmployeesResult {
  return { claimed: [], unqualified: [], waiting: [] };
}

function makeFlatNavGrid(width: number, height: number): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells);
}

/** Impassable vertical wall spanning every row at world x. */
function blockColumn(grid: NavGrid, x: number): void {
  for (let z = 0; z < grid.height; z++) {
    grid.cells[z]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
  }
}

describe('claimActionsTargetedAtEmployee', () => {
  it('claims a targeted action and promotes it to active when the employee is idle', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const action = makeAction({ id: 1, targetEmployeeId: employee.id });
    state.pendingActions.push(action);
    const result = makeResult();

    claimActionsTargetedAtEmployee(state, employee, result);

    expect(result.claimed).toContain(1);
    expect(action.status).toBe('assigned');
    expect(action.holderId).toBe(employee.id);
    expect(employee.activeActionId).toBe(1);
  });

  it('promotes the first targeted action to active and pushes the rest onto taskQueue', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const first = makeAction({ id: 1, targetEmployeeId: employee.id });
    const second = makeAction({ id: 2, targetEmployeeId: employee.id });
    state.pendingActions.push(second, first); // insertion order deliberately reversed
    const result = makeResult();

    claimActionsTargetedAtEmployee(state, employee, result);

    expect(employee.activeActionId).toBe(1); // lowest id, claimed first (id-ascending)
    expect(employee.taskQueue).toContain(2);
    expect(second.status).toBe('assigned');
    expect(second.holderId).toBe(employee.id);
    expect(result.claimed).toEqual(expect.arrayContaining([1, 2]));
  });

  it('stops claiming once depth (active + taskQueue) reaches MAX_EMPLOYEE_TASK_QUEUE_DEPTH', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    employee.activeActionId = 999; // occupies one slot
    employee.taskQueue = Array.from(
      { length: MAX_EMPLOYEE_TASK_QUEUE_DEPTH - 1 },
      (_, i) => 900 + i,
    ); // fills the rest — depth is already at the cap

    const action = makeAction({ id: 10, targetEmployeeId: employee.id });
    state.pendingActions.push(action);
    const result = makeResult();

    claimActionsTargetedAtEmployee(state, employee, result);

    expect(result.claimed).not.toContain(10);
    expect(action.status).toBe('queued');
    expect(action.holderId).toBeNull();
  });

  it('leaves an action targeted at a different employee untouched', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const action = makeAction({ id: 20, targetEmployeeId: 9999 });
    state.pendingActions.push(action);
    const result = makeResult();

    claimActionsTargetedAtEmployee(state, employee, result);

    expect(result.claimed).not.toContain(20);
    expect(action.status).toBe('queued');
    expect(employee.activeActionId).toBeNull();
  });

  it('leaves a vehicle-gated targeted action queued when no free vehicle exists', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0); // has 'blasting'
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    // No drill_rig vehicle purchased — nothing to reserve.

    const action = makeAction({
      id: 30, targetEmployeeId: employee.id, requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig',
    });
    state.pendingActions.push(action);
    const result = makeResult();

    claimActionsTargetedAtEmployee(state, employee, result);

    expect(result.claimed).not.toContain(30);
    expect(action.status).toBe('queued');
    expect(employee.activeActionId).toBeNull();
  });

  it('excludes a non-claimable haul_debris action (fragment no longer resolvable)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const action = makeAction({
      id: 40, type: 'haul_debris', targetEmployeeId: employee.id,
      requiredVehicleRole: 'debris_hauler', payload: { fragmentId: 999999 },
    });
    state.pendingActions.push(action);
    const result = makeResult();

    claimActionsTargetedAtEmployee(state, employee, result);

    expect(result.claimed).not.toContain(40);
    expect(action.status).toBe('queued');
  });
});

describe('fillIdleEmployeeFromQueueOrPool', () => {
  it('claims from the open pool when the own taskQueue is empty', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const poolAction = makeAction({ id: 1, targetX: 5, targetZ: 5 });
    state.pendingActions.push(poolAction);
    const result = makeResult();

    fillIdleEmployeeFromQueueOrPool(state, employee, result);

    expect(employee.activeActionId).toBe(1);
    expect(result.claimed).toContain(1);
    expect(poolAction.status).toBe('assigned');
    expect(poolAction.holderId).toBe(employee.id);
  });

  it("takes priority from the employee's own taskQueue over the open pool", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const queuedAction = makeAction({
      id: 2, targetX: 1, targetZ: 1, status: 'assigned', holderId: employee.id,
    });
    const poolAction = makeAction({ id: 3, targetX: 2, targetZ: 2 });
    state.pendingActions.push(queuedAction, poolAction);
    employee.taskQueue = [2];
    const result = makeResult();

    fillIdleEmployeeFromQueueOrPool(state, employee, result);

    expect(employee.activeActionId).toBe(2);
    expect(employee.taskQueue).not.toContain(2);
    // The pool candidate is untouched — the queue entry wins, never both.
    expect(poolAction.status).toBe('queued');
    expect(poolAction.holderId).toBeNull();
  });

  it('prunes a stale taskQueue entry (no longer assigned/held by this employee) and falls through to the pool', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    // id 5 never landed in pendingActions at all — the stalest possible case.
    const poolAction = makeAction({ id: 6, targetX: 1, targetZ: 1 });
    state.pendingActions.push(poolAction);
    employee.taskQueue = [5];
    const result = makeResult();

    fillIdleEmployeeFromQueueOrPool(state, employee, result);

    expect(employee.taskQueue).not.toContain(5);
    expect(employee.activeActionId).toBe(6);
  });

  it('#816: an unreachable-but-still-assigned-and-held queue entry falls through to the pool instead of returning early', () => {
    const state = createGame({ seed: SEED });
    const grid = makeFlatNavGrid(30, 5);
    blockColumn(grid, 3); // walls off x >= 3 from the employee's own column
    state.navGrid = grid;
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const staleQueued = makeAction({
      id: 7, targetX: 10, targetZ: 0, status: 'assigned', holderId: employee.id,
    });
    const poolCandidate = makeAction({ id: 8, targetX: 1, targetZ: 0 });
    state.pendingActions.push(staleQueued, poolCandidate);
    employee.taskQueue = [7];
    const result = makeResult();

    fillIdleEmployeeFromQueueOrPool(state, employee, result);

    expect(employee.activeActionId).toBe(8);
    // Retried, not dropped — still sitting in taskQueue/pendingActions,
    // available to resume automatically once reachable again.
    expect(employee.taskQueue).toContain(7);
    expect(staleQueued.status).toBe('assigned');
    expect(staleQueued.holderId).toBe(employee.id);
  });

  it('no-op when nothing is claimable anywhere', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const result = makeResult();

    fillIdleEmployeeFromQueueOrPool(state, employee, result);

    expect(employee.activeActionId).toBeNull();
    expect(result.claimed).toEqual([]);
  });
});

describe('claimOnePoolCandidate', () => {
  it('returns {action, totalTicks} and self-claims the winning candidate', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const action = makeAction({ id: 1, targetX: 3, targetZ: 3 });
    state.pendingActions.push(action);

    const selection = claimOnePoolCandidate(state, employee);

    expect(selection).not.toBeNull();
    expect(selection!.action.id).toBe(1);
    expect(typeof selection!.totalTicks).toBe('number');
    expect(action.status).toBe('assigned');
    expect(action.holderId).toBe(employee.id);
  });

  it('returns null when the pool is empty', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    expect(claimOnePoolCandidate(state, employee)).toBeNull();
  });

  it('filters out a candidate the employee lacks the required skill for', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0); // only 'blasting'

    const action = makeAction({ id: 1, requiredSkill: 'geology' });
    state.pendingActions.push(action);

    expect(claimOnePoolCandidate(state, employee)).toBeNull();
    expect(action.status).toBe('queued');
  });

  it('returns null for a vehicle-gated candidate when no free vehicle exists', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0); // has 'blasting'
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    const action = makeAction({
      id: 1, requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig', targetX: 5, targetZ: 5,
    });
    state.pendingActions.push(action);

    expect(claimOnePoolCandidate(state, employee)).toBeNull();
    expect(action.status).toBe('queued');
  });

  it('returns a selection AND reserves the vehicle when one is free', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0); // has 'blasting'
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    const action = makeAction({
      id: 1, requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig', targetX: 5, targetZ: 5,
    });
    state.pendingActions.push(action);

    const selection = claimOnePoolCandidate(state, employee);

    expect(selection).not.toBeNull();
    expect(selection!.action.id).toBe(1);
    const vehicle = state.vehicles.vehicles[0]!;
    expect(vehicle.reservedForActionId).toBe(1);
    expect(action.status).toBe('assigned');
    expect(action.holderId).toBe(employee.id);
  });

  it('excludes a non-claimable haul_debris/fragment_debris action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const action = makeAction({
      id: 1, type: 'haul_debris', requiredVehicleRole: 'debris_hauler', payload: { fragmentId: 999999 },
    });
    state.pendingActions.push(action);

    expect(claimOnePoolCandidate(state, employee)).toBeNull();
  });

  it('excludes a dig_ramp_segment whose immediate predecessor is not yet done (ramp-segment gate)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.rock_digger, 1); // driving.excavator
    purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);

    state.plannedRamps.push({
      id: 1,
      def: { originX: 0, originZ: 0, direction: 'south', length: 3, targetDepth: 6 },
      footprint: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      segments: [
        { index: 0, actionId: 10, cells: [], region: null, done: false }, // segment 0 not yet done
        { index: 1, actionId: 11, cells: [], region: null, done: false },
      ],
    });

    const action = makeAction({
      id: 11, type: 'dig_ramp_segment', requiredSkill: 'driving.excavator',
      requiredVehicleRole: 'rock_digger', targetX: 5, targetZ: 5,
      payload: { rampId: 1, segmentIndex: 1 },
    });
    state.pendingActions.push(action);

    expect(claimOnePoolCandidate(state, employee)).toBeNull();
    expect(action.status).toBe('queued');
  });
});

describe('reserveOnePoolActionAhead', () => {
  function pushActive(state: GameState, employeeId: number, id: number, type: PendingAction['type'] = 'general_work'): PendingAction {
    const action = makeAction({ id, type, status: 'in_progress', holderId: employeeId, targetX: 0, targetZ: 0 });
    state.pendingActions.push(action);
    return action;
  }

  it('reserves one pool action ahead into taskQueue for a busy, non-resting employee with room', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const active = pushActive(state, employee.id, 1);
    employee.activeActionId = active.id;

    const poolAction = makeAction({ id: 2, targetX: 1, targetZ: 1 });
    state.pendingActions.push(poolAction);
    const result = makeResult();

    reserveOnePoolActionAhead(state, employee, result);

    expect(employee.taskQueue).toContain(2);
    expect(employee.activeActionId).toBe(1); // unchanged — reserved ahead, not promoted
    expect(result.claimed).toContain(2);
    expect(poolAction.status).toBe('assigned');
    expect(poolAction.holderId).toBe(employee.id);
  });

  it('no-op when the active action is stale/missing', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 999; // no matching PendingAction record

    const poolAction = makeAction({ id: 2, targetX: 1, targetZ: 1 });
    state.pendingActions.push(poolAction);
    const result = makeResult();

    reserveOnePoolActionAhead(state, employee, result);

    expect(employee.taskQueue).toEqual([]);
    expect(result.claimed).toEqual([]);
  });

  it("no-op when the active action's type is 'rest'", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const active = pushActive(state, employee.id, 1, 'rest');
    employee.activeActionId = active.id;

    const poolAction = makeAction({ id: 2, targetX: 1, targetZ: 1 });
    state.pendingActions.push(poolAction);
    const result = makeResult();

    reserveOnePoolActionAhead(state, employee, result);

    expect(employee.taskQueue).toEqual([]);
    expect(result.claimed).toEqual([]);
  });

  it('no-op at the MAX_EMPLOYEE_TASK_QUEUE_DEPTH boundary', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const active = pushActive(state, employee.id, 1);
    employee.activeActionId = active.id;
    employee.taskQueue = Array.from({ length: MAX_EMPLOYEE_TASK_QUEUE_DEPTH - 1 }, (_, i) => 900 + i);

    const poolAction = makeAction({ id: 2, targetX: 1, targetZ: 1 });
    state.pendingActions.push(poolAction);
    const result = makeResult();

    reserveOnePoolActionAhead(state, employee, result);

    expect(employee.taskQueue.length).toBe(MAX_EMPLOYEE_TASK_QUEUE_DEPTH - 1);
    expect(result.claimed).toEqual([]);
  });

  it('no-op when the pool has nothing claimable', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const active = pushActive(state, employee.id, 1);
    employee.activeActionId = active.id;
    const result = makeResult();

    reserveOnePoolActionAhead(state, employee, result);

    expect(employee.taskQueue).toEqual([]);
    expect(result.claimed).toEqual([]);
  });
});

describe('promoteActionToActive', () => {
  it('sets activeActionId/destination and seeds task timer fields for a non-rest, non-vehicle action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0); // has 'blasting'

    const action = makeAction({ id: 1, targetX: 5, targetZ: 7, requiredSkill: 'blasting' });

    promoteActionToActive(state, employee, action);

    expect(employee.activeActionId).toBe(1);
    expect(employee.destinationX).toBe(5);
    expect(employee.destinationZ).toBe(7);
    expect(employee.pendingTaskDuration).not.toBeNull();
    expect(employee.activeTaskSkill).toBe('blasting');
    expect(employee.pendingActionType).toBe('general_work');
    expect(employee.pendingActionPayload).toBe(action.payload);
  });

  it('routes a vehicle-gated action through vehicle-gated promotion, leaving task timer fields null', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const vehicle = state.vehicles.vehicles[0]!;

    const action = makeAction({
      id: 2, requiredVehicleRole: 'drill_rig', requiredSkill: 'blasting', targetX: 10, targetZ: 10,
    });
    reserveVehicle(vehicle, action.id);

    promoteActionToActive(state, employee, action);

    expect(employee.activeActionId).toBe(2);
    // Work duration is seeded later, on the VEHICLE's arrival — not here.
    expect(employee.pendingTaskDuration).toBeNull();
    expect(employee.taskTicksRemaining).toBeNull();
    expect(employee.pendingDriverVehicleId).toBe(vehicle.id);
  });

  it('seeds pendingRestDuration/pendingRestNeedKey for a rest action with a resolvable needKey and no rest in flight', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const action = makeAction({
      id: 3, type: 'rest', targetX: 2, targetZ: 3, payload: { needKey: 'hunger' },
    });

    promoteActionToActive(state, employee, action);

    expect(employee.activeActionId).toBe(3);
    expect(employee.destinationX).toBe(2);
    expect(employee.destinationZ).toBe(3);
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.hunger);
    expect(employee.pendingRestNeedKey).toBe('hunger');
    expect(employee.pendingTaskDuration).toBeNull();
  });

  it('is a no-op on pendingRestDuration/pendingRestNeedKey for a rest action with an unresolvable needKey', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const action = makeAction({ id: 4, type: 'rest', targetX: 1, targetZ: 1, payload: {} });

    promoteActionToActive(state, employee, action);

    expect(employee.activeActionId).toBe(4);
    expect(employee.destinationX).toBe(1); // destination is still set
    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.pendingRestNeedKey).toBeNull();
  });

  it('does not re-seed pendingRestDuration when the employee already has restTicksRemaining set (guard)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.restTicksRemaining = 5; // already mid-rest via a different path

    const action = makeAction({
      id: 5, type: 'rest', targetX: 1, targetZ: 1, payload: { needKey: 'fatigue' },
    });

    promoteActionToActive(state, employee, action);

    expect(employee.activeActionId).toBe(5); // still set unconditionally
    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.pendingRestNeedKey).toBeNull();
  });
});
