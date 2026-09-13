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
  releaseUnboardedTaskQueueVehicleReservations,
  promoteActionToActive,
  type TickEmployeesResult,
} from '../../../src/core/engine/EmployeeDispatchSteps.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { MAX_EMPLOYEE_TASK_QUEUE_DEPTH, NEED_REST_DURATIONS, ACTION_STARVATION_TICK_THRESHOLD } from '../../../src/core/config/balance.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { computeEmployeeActivity } from '../../../src/core/entities/EmployeeActivity.js';

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
    queuedAtTick: 0,
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

  it('#1000 CI follow-up: a starved on-foot pool action beats a nearer, freshly queued one — cost ranking alone never rescues it', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    state.tickCount = ACTION_STARVATION_TICK_THRESHOLD + 10;

    // The nearer candidate is what the cost ranking would pick every tick.
    const nearFresh = makeAction({ id: 1, targetX: 1, targetZ: 1, queuedAtTick: state.tickCount });
    const farStarved = makeAction({ id: 2, targetX: 9, targetZ: 9, queuedAtTick: 0 });
    state.pendingActions.push(nearFresh, farStarved);
    const result = makeResult();

    fillIdleEmployeeFromQueueOrPool(state, employee, result);

    expect(employee.activeActionId).toBe(2);
    expect(farStarved.status).toBe('assigned');
    expect(farStarved.holderId).toBe(employee.id);
    expect(result.claimed).toContain(2);
    expect(nearFresh.status).toBe('queued');
  });

  it('#1000 CI follow-up: an on-foot pool action younger than the threshold does not override the cost ranking', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    state.tickCount = ACTION_STARVATION_TICK_THRESHOLD + 10;

    const nearFresh = makeAction({ id: 1, targetX: 1, targetZ: 1, queuedAtTick: state.tickCount });
    const farNotYetStarved = makeAction({
      id: 2, targetX: 9, targetZ: 9, queuedAtTick: state.tickCount - ACTION_STARVATION_TICK_THRESHOLD + 1,
    });
    state.pendingActions.push(nearFresh, farNotYetStarved);
    const result = makeResult();

    fillIdleEmployeeFromQueueOrPool(state, employee, result);

    expect(employee.activeActionId).toBe(1);
    expect(farNotYetStarved.status).toBe('queued');
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

  // #954 follow-up (economy-full-loop regression): a vehicle-gated queue entry
  // reserved ahead of time (reserveOnePoolActionAhead) but never boarded can
  // otherwise stay locked to its holder forever once resolveActionCost's own
  // occupancy check correctly refuses to promote a claim whose holder's own
  // foot-walk to the reserved vehicle is genuinely blocked — see
  // canReassignStrandedReservation's own doc comment (VehicleReservation.ts).
  describe('stranded vehicle-gated reservation release (#954 follow-up)', () => {
    it('releases a queue entry back to the open pool when its reserved vehicle has no driver and a different idle, licensed employee is available — who then claims it', () => {
      const state = createGame({ seed: SEED });
      const grid = makeFlatNavGrid(30, 10);
      blockColumn(grid, 10); // isolates x < 10 (holder) from x >= 10 (vehicle, other)
      state.navGrid = grid;
      const rng = new Random(SEED);
      const { employee: holder } = hireEmployee(state.employees, 'driller', rng, 0, 0);
      // holder deliberately NOT licensed for drill_rig — irrelevant to
      // canReassignStrandedReservation, which only requires a DIFFERENT
      // licensed idle employee, but keeps holder's own fallback pool claim
      // from muddying the assertions below.
      const { employee: other } = hireEmployee(state.employees, 'driller', rng, 25, 0);
      assignSkill(state.employees, other.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

      const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 20, 0);
      const action = makeAction({
        id: 50, targetX: 20, targetZ: 0, requiredVehicleRole: 'drill_rig',
        status: 'assigned', holderId: holder.id, targetEmployeeId: null,
      });
      state.pendingActions.push(action);
      holder.taskQueue = [50];
      vehicle.reservedForActionId = action.id;
      // vehicle.driverId stays null — never actually boarded.

      const result1 = makeResult();
      fillIdleEmployeeFromQueueOrPool(state, holder, result1);

      expect(holder.taskQueue).not.toContain(50);
      expect(holder.activeActionId).toBeNull();
      expect(action.status).toBe('queued');
      expect(action.holderId).toBeNull();
      expect(vehicle.reservedForActionId).toBeNull();

      const result2 = makeResult();
      fillIdleEmployeeFromQueueOrPool(state, other, result2);

      expect(other.activeActionId).toBe(50);
      expect(action.status).toBe('assigned');
      expect(action.holderId).toBe(other.id);
      expect(vehicle.reservedForActionId).toBe(50);
    });

    it('never releases a reservation whose vehicle already has a driver — real boarding progress is never discarded', () => {
      const state = createGame({ seed: SEED });
      const grid = makeFlatNavGrid(30, 10);
      blockColumn(grid, 10); // isolates x < 10 (holder) from x >= 10 (vehicle/target, other)
      state.navGrid = grid;
      const rng = new Random(SEED);
      const { employee: holder } = hireEmployee(state.employees, 'driller', rng, 0, 0);
      const { employee: other } = hireEmployee(state.employees, 'driller', rng, 25, 0);
      assignSkill(state.employees, other.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

      const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 20, 0);
      vehicle.driverId = holder.id; // already boarded
      const action = makeAction({
        id: 51, targetX: 20, targetZ: 0, requiredVehicleRole: 'drill_rig',
        status: 'assigned', holderId: holder.id, targetEmployeeId: null,
      });
      state.pendingActions.push(action);
      holder.taskQueue = [51];
      vehicle.reservedForActionId = action.id;

      const result = makeResult();
      fillIdleEmployeeFromQueueOrPool(state, holder, result);

      // Still pinned to holder — the boarded driver's progress is never
      // discarded to hand the vehicle to a merely-idle other employee.
      expect(holder.taskQueue).toContain(51);
      expect(action.status).toBe('assigned');
      expect(action.holderId).toBe(holder.id);
      expect(vehicle.reservedForActionId).toBe(51);
      expect(other.activeActionId).toBeNull();
    });
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

  // #1002 — deferVehicleGatedToIdleAlternative: see this function's own doc
  // comment. Exercised end-to-end via tickEmployees in EmployeeDispatch.test.ts;
  // these isolate the flag directly against claimOnePoolCandidate itself.
  describe('deferVehicleGatedToIdleAlternative (#1002)', () => {
    it('skips a vehicle-gated candidate when a different, idle, licensed employee could claim it instead', () => {
      const state = createGame({ seed: SEED });
      const rng = new Random(SEED);
      const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
      assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
      purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

      const { employee: idleAlternative } = hireEmployee(state.employees, 'driller', rng, 1, 1);
      assignSkill(state.employees, idleAlternative.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
      // idleAlternative stays fully idle: activeActionId null, not resting, not training.

      const action = makeAction({
        id: 1, requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig', targetX: 5, targetZ: 5,
      });
      state.pendingActions.push(action);

      expect(claimOnePoolCandidate(state, employee, false, true)).toBeNull();
      expect(action.status).toBe('queued');
    });

    it('still claims a vehicle-gated candidate when no OTHER idle licensed employee exists', () => {
      const state = createGame({ seed: SEED });
      const rng = new Random(SEED);
      const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
      assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
      purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

      const action = makeAction({
        id: 1, requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig', targetX: 5, targetZ: 5,
      });
      state.pendingActions.push(action);

      const selection = claimOnePoolCandidate(state, employee, false, true);

      expect(selection).not.toBeNull();
      expect(selection!.action.id).toBe(1);
    });

    it('does not defer an on-foot candidate (requiredVehicleRole: null), even with an idle alternative standing by', () => {
      const state = createGame({ seed: SEED });
      const rng = new Random(SEED);
      const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

      hireEmployee(state.employees, 'driller', rng, 1, 1); // fully idle, but irrelevant — action is on-foot

      const action = makeAction({ id: 1, targetX: 5, targetZ: 5 });
      state.pendingActions.push(action);

      const selection = claimOnePoolCandidate(state, employee, false, true);

      expect(selection).not.toBeNull();
      expect(selection!.action.id).toBe(1);
    });

    it('does NOT defer when the flag is left false (default), even with an idle licensed alternative standing by', () => {
      const state = createGame({ seed: SEED });
      const rng = new Random(SEED);
      const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
      assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
      purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

      const { employee: idleAlternative } = hireEmployee(state.employees, 'driller', rng, 1, 1);
      assignSkill(state.employees, idleAlternative.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

      const action = makeAction({
        id: 1, requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig', targetX: 5, targetZ: 5,
      });
      state.pendingActions.push(action);

      const selection = claimOnePoolCandidate(state, employee, false);

      expect(selection).not.toBeNull();
      expect(selection!.action.id).toBe(1);
    });
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

  it('does not reserve ahead an on-foot (requiredVehicleRole: null) pool candidate while busy on a vehicle-gated action (#1000)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const active = pushActive(state, employee.id, 1);
    active.requiredVehicleRole = 'drill_rig';
    employee.activeActionId = active.id;

    const poolAction = makeAction({ id: 2, targetX: 1, targetZ: 1, requiredVehicleRole: null });
    state.pendingActions.push(poolAction);
    const result = makeResult();

    reserveOnePoolActionAhead(state, employee, result);

    expect(employee.taskQueue).toEqual([]);
    expect(result.claimed).toEqual([]);
    expect(poolAction.status).toBe('queued');
  });

  it('DOES reserve ahead a pool candidate of a DIFFERENT vehicle role the busy driver also holds a licence for (#1000-followup): a mismatched-role reservation is still redeemable via the ordinary idle path once the employee holds that role\'s own licence', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.debris_hauler, 1);
    purchaseVehicle(state.vehicles, 'debris_hauler', 1, 1); // free, and this driver IS licensed for it

    const active = pushActive(state, employee.id, 1);
    active.requiredVehicleRole = 'drill_rig';
    employee.activeActionId = active.id;

    const poolAction = makeAction({ id: 2, targetX: 1, targetZ: 1, requiredVehicleRole: 'debris_hauler' });
    state.pendingActions.push(poolAction);
    const result = makeResult();

    reserveOnePoolActionAhead(state, employee, result);

    expect(employee.taskQueue).toContain(2);
    expect(result.claimed).toContain(2);
    expect(poolAction.status).toBe('assigned');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #1002 — a starvation-override dismount (VehicleContinuity.ts's
// completeVehicleGatedActionIfApplicable) bypasses employee.taskQueue
// entirely, so a vehicle already reserved by reserveOnePoolActionAhead for an
// earlier, not-yet-started taskQueue entry stays locked-but-idle for the
// whole on-foot detour unless something explicitly frees it first. This is
// that something.
// ═══════════════════════════════════════════════════════════════════════════

describe('releaseUnboardedTaskQueueVehicleReservations (#1002)', () => {
  it('releases a vehicle-gated, unboarded taskQueue entry fully back to the open pool', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.debris_hauler, 1);

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const action = makeAction({
      id: 1, requiredVehicleRole: 'debris_hauler', targetX: 5, targetZ: 5,
      status: 'assigned', holderId: employee.id,
    });
    state.pendingActions.push(action);
    employee.taskQueue = [1];
    vehicle.reservedForActionId = 1;
    // vehicle.driverId stays null — reserved but never boarded.

    releaseUnboardedTaskQueueVehicleReservations(state, employee);

    expect(employee.taskQueue).not.toContain(1);
    expect(action.status).toBe('queued');
    expect(action.holderId).toBeNull();
    expect(vehicle.reservedForActionId).toBeNull();
  });

  it('leaves an on-foot (requiredVehicleRole: null) taskQueue entry untouched', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const action = makeAction({
      id: 2, requiredVehicleRole: null, status: 'assigned', holderId: employee.id,
    });
    state.pendingActions.push(action);
    employee.taskQueue = [2];

    releaseUnboardedTaskQueueVehicleReservations(state, employee);

    expect(employee.taskQueue).toContain(2);
    expect(action.status).toBe('assigned');
    expect(action.holderId).toBe(employee.id);
  });

  it('no-ops without throwing on an empty taskQueue', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    expect(() => releaseUnboardedTaskQueueVehicleReservations(state, employee)).not.toThrow();
    expect(employee.taskQueue).toEqual([]);
  });

  it('leaves an already-boarded reservation untouched (defensive — should not occur in practice, a taskQueue-only entry is never boarded)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { employee: otherDriver } = hireEmployee(state.employees, 'driller', rng, 10, 10);

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    vehicle.driverId = otherDriver.id; // already boarded, by someone else

    const action = makeAction({
      id: 3, requiredVehicleRole: 'debris_hauler', targetX: 5, targetZ: 5,
      status: 'assigned', holderId: employee.id,
    });
    state.pendingActions.push(action);
    employee.taskQueue = [3];
    vehicle.reservedForActionId = 3;

    releaseUnboardedTaskQueueVehicleReservations(state, employee);

    expect(employee.taskQueue).toContain(3);
    expect(action.status).toBe('assigned');
    expect(action.holderId).toBe(employee.id);
    expect(vehicle.reservedForActionId).toBe(3);
    expect(vehicle.driverId).toBe(otherDriver.id);
  });

  it('releases every unboarded vehicle-gated entry among a mixed taskQueue, leaving the on-foot one alone', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const { vehicle: v1 } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const { vehicle: v2 } = purchaseVehicle(state.vehicles, 'debris_hauler', 6, 6);

    const gated1 = makeAction({
      id: 10, requiredVehicleRole: 'debris_hauler', targetX: 5, targetZ: 5,
      status: 'assigned', holderId: employee.id,
    });
    const gated2 = makeAction({
      id: 11, requiredVehicleRole: 'debris_hauler', targetX: 6, targetZ: 6,
      status: 'assigned', holderId: employee.id,
    });
    const onFoot = makeAction({
      id: 12, requiredVehicleRole: null, targetX: 7, targetZ: 7,
      status: 'assigned', holderId: employee.id,
    });
    state.pendingActions.push(gated1, gated2, onFoot);
    employee.taskQueue = [10, 11, 12];
    v1.reservedForActionId = 10;
    v2.reservedForActionId = 11;

    releaseUnboardedTaskQueueVehicleReservations(state, employee);

    expect(employee.taskQueue).toEqual([12]);
    expect(gated1.status).toBe('queued');
    expect(gated1.holderId).toBeNull();
    expect(v1.reservedForActionId).toBeNull();
    expect(gated2.status).toBe('queued');
    expect(gated2.holderId).toBeNull();
    expect(v2.reservedForActionId).toBeNull();
    expect(onFoot.status).toBe('assigned');
    expect(onFoot.holderId).toBe(employee.id);
  });

  it('skips a taskQueue id whose PendingAction no longer exists in state.pendingActions, without throwing', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    employee.taskQueue = [999]; // no matching PendingAction record at all

    expect(() => releaseUnboardedTaskQueueVehicleReservations(state, employee)).not.toThrow();
  });

  it('skips a vehicle-gated taskQueue entry whose reservation vehicle no longer exists, without throwing', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const action = makeAction({
      id: 20, requiredVehicleRole: 'debris_hauler', targetX: 5, targetZ: 5,
      status: 'assigned', holderId: employee.id,
    });
    state.pendingActions.push(action);
    employee.taskQueue = [20];
    // No vehicle purchased at all — nothing has reservedForActionId === 20.

    expect(() => releaseUnboardedTaskQueueVehicleReservations(state, employee)).not.toThrow();
    expect(employee.taskQueue).toContain(20);
    expect(action.status).toBe('assigned');
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
      id: 3, type: 'rest', targetX: 2, targetZ: 3, payload: { needKey: 'fatigue' },
    });

    promoteActionToActive(state, employee, action);

    expect(employee.activeActionId).toBe(3);
    expect(employee.destinationX).toBe(2);
    expect(employee.destinationZ).toBe(3);
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.fatigue);
    expect(employee.pendingRestNeedKey).toBe('fatigue');
    expect(employee.pendingTaskDuration).toBeNull();
  });

  // #1013: mirrors NeedRestoration.test.ts's and ForceShiftRest.test.ts's own
  // #1013 tests for the other rest-dispatch call sites — this is the first
  // point an idle employee actually starts walking to rest (this promotion's
  // own doc comment above), so computeEmployeeActivity must report
  // actionType: 'rest' here too, not just once pendingRestDuration/
  // pendingRestNeedKey are seeded a few lines later in this same call.
  it('#1013: reports actionType "rest" via computeEmployeeActivity while walking to the rest destination', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const action = makeAction({
      id: 6, type: 'rest', targetX: 8, targetZ: 9, payload: { needKey: 'fatigue' },
    });

    promoteActionToActive(state, employee, action);

    const activity = computeEmployeeActivity(employee, state.vehicles.vehicles);
    expect(activity.kind).toBe('walking');
    expect(activity.actionType).toBe('rest');
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
