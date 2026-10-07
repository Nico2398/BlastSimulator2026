// BlastSimulator2026 — Tests for employee dispatch: claim logic, cost-based
// dispatch, vehicle-gated actions, and the drill_hole/charge_hole/
// dig_ramp_segment action families (relocated from GameLoop.test.ts, #759).

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { tickEmployees, employeeWorkState } from '../../../src/core/engine/EmployeeDispatch.js';
import { refreshOrderReachability } from '../../../src/core/engine/OrderReachability.js';
import { board } from '../../../src/core/engine/Mount.js';
import { tickCollapse } from '../../../src/core/engine/NeedRestoration.js';
import { tickTaskProgress } from '../../../src/core/engine/TaskProgress.js';
import { tickArrivalGate } from '../../../src/core/engine/ArrivalGate.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';
import { claimPendingAction, completePendingAction, dispatchPendingAction } from '../../../src/core/engine/TaskDispatch.js';
// #1090: VehicleContinuity.ts (tryContinueVehicleGatedAction,
// completeVehicleGatedActionIfApplicable) is deleted — completeVehicleGatedAction
// (VehicleReservation.ts) is now the sole vehicle-gated completion entry
// point, with no continuity fast path of its own (resolveActionCost/
// planItinerary own that now).
import { completeVehicleGatedAction } from '../../../src/core/engine/VehicleReservation.js';
import { isRampSegmentClaimable, isChargeHoleClaimable } from '../../../src/core/engine/ActionSelection.js';
import {
  hireEmployee, assignSkill, getNeedMultiplier, computeTaskDuration, killEmployee, fireEmployee,
} from '../../../src/core/entities/Employee.js';
import type { PendingAction, PlannedRamp, RampSegmentTracker } from '../../../src/core/state/GameState.js';
import { purchaseVehicle, destroyVehicle, ROLE_LICENCE_REQUIRED, getVehicleReservation } from '../../../src/core/entities/Vehicle.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { landDrilledHole, type PlannedHole } from '../../../src/core/mining/DrillPlan.js';
import { landLoadedCharge } from '../../../src/core/mining/ChargePlan.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import { getLivingQuartersWellbeingMultiplier } from '../../../src/core/entities/BuildingWellbeing.js';
import {
  BASE_TASK_DURATION_TICKS,
  MAX_EMPLOYEE_TASK_QUEUE_DEPTH,
  NEED_HARD_THRESHOLDS,
  NAV_CLEARANCE_EMPLOYEE_CELLS,
} from '../../../src/core/config/balance.js';

/**
 * Rest/task timers are arrival-gated (#437): tickEmployees only queues
 * pendingRestDuration/pendingTaskDuration; ArrivalGate.tickArrivalGate
 * promotes them into restTicksRemaining/taskTicksRemaining once the
 * employee has actually walked to targetX/targetZ. Call after tickEmployees
 * in tests that build fixtures already co-located with their target (the
 * common case below, both at (0,0)) to resolve that walk in one step.
 */
function resolveArrival(state: GameState): void {
  tickLocomotion(state);
  tickArrivalGate(state);
}


describe('tickEmployees — claim logic (Task 3.6)', () => {
  const SEED = 42;

  /**
   * Build a minimal PendingAction for tests. Defaults to 'queued'/unheld
   * (#547) — the shape tickEmployees requires to even consider claiming it;
   * override status/holderId explicitly for tests that need a different
   * lifecycle state.
   */
  function makePendingAction(
    overrides: Partial<PendingAction> & { id: number; requiredSkill: PendingAction['requiredSkill'] },
  ): PendingAction {
    return {
      type: 'drill_hole',
      requiredVehicleRole: null,
      targetX: 0,
      targetZ: 0,
      targetY: 0,
      payload: {},
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
      ...overrides,
    };
  }

  it('assigns idle qualified employee to matching pending action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, 'blasting', 1);

    const action = makePendingAction({ id: 1, requiredSkill: 'blasting' });
    state.pendingActions.push(action);

    tickEmployees(state);

    // Action should have been claimed — the record STAYS in pendingActions,
    // only its status/holderId change (#547); it is no longer spliced out at
    // claim time.
    expect(state.pendingActions).toHaveLength(1);
    expect(state.pendingActions[0]!.status).toBe('assigned');
    expect(state.pendingActions[0]!.holderId).toBe(employee.id);
    // Employee should hold the action's id
    expect((employee as any).activeActionId).toBe(action.id);
  });

  it('flips the matching GhostPreview to claimed:true when the action is claimed, without removing it (#547, regression for #406)', () => {
    // tickEmployees is the tick loop's real claim path — claimPendingAction in
    // TaskDispatch.ts is a separate helper nothing in the loop calls — so it
    // must own updating ghostPreviews itself. Before #547 this deleted the
    // ghost outright; now the ghost survives the claim (dimmer/slower — see
    // GhostMesh.ts) and only disappears when the action itself completes.
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, 'blasting', 1);

    const action = makePendingAction({ id: 3, requiredSkill: 'blasting', targetX: 5, targetZ: 6 });
    state.pendingActions.push(action);
    state.ghostPreviews.push({ id: 3, type: action.type, targetX: 5, targetZ: 6, targetY: 0, claimed: false });

    tickEmployees(state);

    const ghost = state.ghostPreviews.find(g => g.id === 3);
    expect(ghost).toBeDefined();
    expect(ghost!.claimed).toBe(true);
  });

  it('leaves an unclaimed action\'s GhostPreview untouched, still claimed:false (issue #406)', () => {
    const state = createGame({ seed: SEED });
    // No employees hired — action stays pending and unclaimed.

    const action = makePendingAction({ id: 4, requiredSkill: 'geology', targetX: 1, targetZ: 2 });
    state.pendingActions.push(action);
    state.ghostPreviews.push({ id: 4, type: action.type, targetX: 1, targetZ: 2, targetY: 0, claimed: false });

    tickEmployees(state);

    const ghost = state.ghostPreviews.find(g => g.id === 4);
    expect(ghost).toBeDefined();
    expect(ghost!.claimed).toBe(false);
  });

  it('returns claimed action ID in result.claimed', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, 'blasting', 1);

    const action = makePendingAction({ id: 7, requiredSkill: 'blasting' });
    state.pendingActions.push(action);

    const result = tickEmployees(state);

    expect(result.claimed).toContain(7);
  });

  it('leaves unmatched action in pendingActions when roster is empty', () => {
    const state = createGame({ seed: SEED });
    // No employees hired

    const action = makePendingAction({ id: 2, requiredSkill: 'geology' });
    state.pendingActions.push(action);

    tickEmployees(state);

    // No employees at all — action must stay pending
    expect(state.pendingActions).toHaveLength(1);
    expect(state.pendingActions[0]!.id).toBe(2);
  });

  it('returns unqualified action ID in result.unqualified when no roster employee has the skill', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    // Hire an employee with a different skill
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, 'driving.truck', 1);

    // Action requires a skill nobody on the roster has
    const action = makePendingAction({ id: 3, requiredSkill: 'geology' });
    state.pendingActions.push(action);

    const result = tickEmployees(state);

    expect(result.unqualified).toContain(3);
  });

  it('returns waiting action ID when qualified employees all have activeActionId set', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, employee.id, 'blasting', 2);
    // Simulate the employee already being busy
    (employee as any).activeActionId = 99;

    const action = makePendingAction({ id: 4, requiredSkill: 'blasting' });
    state.pendingActions.push(action);

    const result = tickEmployees(state);

    expect(result.waiting).toContain(4);
    // Action must not be consumed
    expect(state.pendingActions).toHaveLength(1);
  });

  it('injured employee is not idle — does not claim action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, 'blasting', 1);
    employee.injured = true;

    const action = makePendingAction({ id: 5, requiredSkill: 'blasting' });
    state.pendingActions.push(action);

    tickEmployees(state);

    // Injured employee cannot work — action stays pending
    expect(state.pendingActions).toHaveLength(1);
    expect((employee as any).activeActionId).toBeNull();
  });

  it('employee in training is not idle — does not claim action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, 'blasting', 1);
    // Simulate employee being in training
    employee.trainingState = { buildingId: 10, skill: 'blasting', ticksRemaining: 5, fee: 500 };

    const action = makePendingAction({ id: 6, requiredSkill: 'blasting' });
    state.pendingActions.push(action);

    tickEmployees(state);

    // Employee in training cannot work — action stays pending
    expect(state.pendingActions).toHaveLength(1);
    expect((employee as any).activeActionId).toBeNull();
  });

  // #1203: an employee walking to enrol in training (pendingTrainingState
  // set) has activeActionId === null and an itinerary in flight (installed by
  // enrolInTraining's own moveTo call) — the exact shape the pre-existing
  // "activeActionId === null && itinerary !== null" guard (#1089 regression
  // fix, above `isMidEvacuation`) already exists to catch, so no dedicated
  // pendingTrainingState guard is needed for the walking half of enrolment.
  // This test pins that the existing guard really does cover it.
  it('does not claim a pending action while walking to enrol in training (pendingTrainingState set, itinerary in flight) (#1203)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, 'blasting', 1);
    employee.activeActionId = null;
    employee.pendingTrainingState = { buildingId: 5, skill: 'blasting', ticksRemaining: 20, fee: 500 };
    employee.itinerary = {
      goal: { kind: 'reposition', x: 40, z: 40 },
      legs: [{
        mode: 'foot', vehicleId: null, destX: 40, destZ: 40,
        arrival: 'exact', onArrive: { kind: 'enter_building', buildingId: 5 }, estTicks: 9,
      }],
      workTicks: 0,
      estTotalTicks: 9,
    };

    const action = makePendingAction({ id: 10, requiredSkill: 'blasting' });
    state.pendingActions.push(action);

    tickEmployees(state);

    expect(state.pendingActions).toHaveLength(1);
    expect(employee.activeActionId).toBeNull();
    expect(employee.pendingTrainingState).not.toBeNull();
  });

  // #1042: an employee mid-evacuation-drive (boarded a driverless vehicle,
  // driving it clear of a danger zone) has activeActionId === null and would
  // otherwise read as plainly idle to tickEmployees — mirrors the
  // pendingDriverVehicleId/isMidEvacuationWalk skips already guarding this
  // loop against claiming over a walk or a boarding-in-progress, but for a
  // drive instead.
  it('an employee mid-evacuation-drive does not claim a pending action (#1042)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, 'blasting', 1);
    employee.activeActionId = null;
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    vehicle.occupantIds = [employee.id];
    // Mid-evacuation-drive is read off the driver's own itinerary since
    // #1092: a `reposition` goal whose last leg puts them back on foot, the
    // shape only clearZone (Zone.ts) ever plans.
    employee.itinerary = {
      goal: { kind: 'reposition', x: 40, z: 40 },
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 40, destZ: 40,
        arrival: 'exact', onArrive: { kind: 'alight' }, estTicks: 9,
      }],
      workTicks: 0,
      estTotalTicks: 9,
    };

    const action = makePendingAction({ id: 9, requiredSkill: 'blasting' });
    state.pendingActions.push(action);

    tickEmployees(state);

    expect(state.pendingActions).toHaveLength(1);
    expect(employee.activeActionId).toBeNull();
  });

  it('multiple pending actions claimed by multiple idle employees', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee: emp1 } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, emp1.id, 'blasting', 1);

    const { employee: emp2 } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, emp2.id, 'blasting', 1);

    const action1 = makePendingAction({ id: 10, requiredSkill: 'blasting' });
    const action2 = makePendingAction({ id: 11, requiredSkill: 'blasting' });
    state.pendingActions.push(action1, action2);

    tickEmployees(state);

    // Both actions must have been claimed — and, per #547, both records
    // still live in pendingActions (only status/holderId changed).
    expect(state.pendingActions).toHaveLength(2);
    for (const a of state.pendingActions) {
      expect(a.status).toBe('assigned');
      expect(a.holderId).not.toBeNull();
    }
    // Each employee holds one of the action IDs
    const assignedIds = [
      (emp1 as any).activeActionId,
      (emp2 as any).activeActionId,
    ];
    expect(assignedIds).toContain(10);
    expect(assignedIds).toContain(11);
    // Each employee has a distinct assignment
    expect(assignedIds[0]).not.toBe(assignedIds[1]);
  });

  it('each employee can only claim one action per tick', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, employee.id, 'blasting', 1);

    const action1 = makePendingAction({ id: 20, requiredSkill: 'blasting' });
    const action2 = makePendingAction({ id: 21, requiredSkill: 'blasting' });
    state.pendingActions.push(action1, action2);

    tickEmployees(state);

    // Only one action can be assigned to the single employee per tick — but
    // per #547 the other stays queued and unheld rather than being spliced
    // away, so BOTH records remain in pendingActions.
    expect(state.pendingActions).toHaveLength(2);
    expect((employee as any).activeActionId).not.toBeNull();
    const claimedAction = state.pendingActions.find(a => a.status === 'assigned');
    const queuedAction = state.pendingActions.find(a => a.status === 'queued');
    expect(claimedAction).toBeDefined();
    // holderId is the claiming employee's id; activeActionId is the claimed
    // action's id — distinct values, not equal to each other (#547).
    expect(claimedAction!.holderId).toBe(employee.id);
    expect((employee as any).activeActionId).toBe(claimedAction!.id);
    expect(queuedAction).toBeDefined();
    expect(queuedAction!.holderId).toBeNull();
  });

  // ── #547: an already-assigned/in_progress action is not re-claimed ─────────

  it('skips an action already "assigned" to another employee — not re-claimed, not counted in claimed/waiting/unqualified', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee: holder } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, holder.id, 'blasting', 1);
    const { employee: idle } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, idle.id, 'blasting', 1);

    const action = makePendingAction({ id: 30, requiredSkill: 'blasting', status: 'assigned', holderId: holder.id });
    state.pendingActions.push(action);
    holder.activeActionId = 30; // mirrors what claiming it would have set

    const result = tickEmployees(state);

    // The idle, equally-qualified employee must not be diverted onto an
    // action someone else already holds.
    expect(idle.activeActionId).toBeNull();
    expect(result.claimed).not.toContain(30);
    expect(result.waiting).not.toContain(30);
    expect(result.unqualified).not.toContain(30);
    // The record is untouched — still held by the original claimant.
    const stored = state.pendingActions.find(a => a.id === 30)!;
    expect(stored.status).toBe('assigned');
    expect(stored.holderId).toBe(holder.id);
  });

  it('skips an "in_progress" action the same way', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee: holder } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, holder.id, 'blasting', 1);
    const { employee: idle } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, idle.id, 'blasting', 1);

    const action = makePendingAction({ id: 31, requiredSkill: 'blasting', status: 'in_progress', holderId: holder.id });
    state.pendingActions.push(action);
    holder.activeActionId = 31;

    const result = tickEmployees(state);

    expect(idle.activeActionId).toBeNull();
    expect(result.claimed).not.toContain(31);
    const stored = state.pendingActions.find(a => a.id === 31)!;
    expect(stored.status).toBe('in_progress');
    expect(stored.holderId).toBe(holder.id);
  });
});

describe('tickEmployees — cost-based dispatch and per-employee task queues (#549)', () => {
  const SEED = 42;

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

  /**
   * One full dispatch → movement → arrival → work tick, mirroring the real
   * ordering the console `tick` command drives (events.ts) but trimmed to
   * only the pieces this suite exercises — no needs/events/economy noise.
   */
  function runFullTick(state: GameState): void {
    tickEmployees(state);
    tickLocomotion(state);
    tickArrivalGate(state);
    for (const emp of state.employees.employees) {
      if (!emp.alive) continue;
      const progress = tickTaskProgress(state, emp);
      if (progress?.completed && progress.actionId !== undefined) {
        completePendingAction(state, progress.actionId);
      }
    }
  }

  it('each of 2 idle employees claims its own nearest reachable action — none doubles up, and the leftover third goes to whoever frees first', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(40, 5);
    const rng = new Random(SEED);

    const { employee: emp1 } = hireEmployee(state.employees, 'blaster', rng, 0, 0);
    const { employee: emp2 } = hireEmployee(state.employees, 'blaster', rng, 30, 0);

    // Near emp1, fast (short work) — emp1 frees first.
    const nearEmp1 = makeAction({ id: 1, targetX: 2, targetZ: 0, requiredSkill: 'blasting', payload: { durationTicks: 2 } });
    // Near emp2, slower than emp1's task — emp2 stays busy after emp1 frees.
    // Total cost is travel + work (#549), so this duration is deliberately
    // kept low enough that near-emp2's total (travel 1 + work 6 = 7) still
    // beats the leftover's total for emp2 (travel 7.5 + work 2 = 9.5) — a
    // duration as large as the task's own travel-vs-leftover gap would make
    // the farther-but-shorter leftover action emp2's cheaper pick instead,
    // which is exactly the failure mode this scenario is meant to rule out.
    const nearEmp2 = makeAction({ id: 2, targetX: 28, targetZ: 0, requiredSkill: 'blasting', payload: { durationTicks: 6 } });
    // Far from both — neither's cheapest at initial dispatch time.
    const leftover = makeAction({ id: 3, targetX: 15, targetZ: 0, requiredSkill: 'blasting', payload: { durationTicks: 2 } });

    // Pushed out of closest-first order deliberately — array order must not
    // determine the outcome.
    state.pendingActions.push(leftover, nearEmp1, nearEmp2);

    tickEmployees(state);

    expect(state.pendingActions.find(a => a.id === 1)!.holderId).toBe(emp1.id);
    expect(state.pendingActions.find(a => a.id === 2)!.holderId).toBe(emp2.id);
    expect(state.pendingActions.find(a => a.id === 3)!.status).toBe('queued');
    expect(state.pendingActions.find(a => a.id === 3)!.holderId).toBeNull();

    // Settle: emp1 finishes its short task quickly and should pick up the
    // leftover next — either directly (once idle) or via the busy-employee
    // pool reservation ahead (step 3 of tickEmployees) on an earlier tick —
    // long before emp2 frees from its own, still-longer task.
    let leftoverHolderWhenClaimed: number | null | undefined;
    for (let i = 0; i < 20 && leftoverHolderWhenClaimed === undefined; i++) {
      runFullTick(state);
      const current = state.pendingActions.find(a => a.id === 3);
      if (current && current.status !== 'queued') {
        leftoverHolderWhenClaimed = current.holderId;
      }
    }

    expect(leftoverHolderWhenClaimed).toBe(emp1.id);
    expect(emp2.activeActionId).toBe(2); // still deep in its own long task
  });

  it('a closer-but-unreachable action stays queued (not stalled) and is claimed once the path opens — retried, not pinned', () => {
    const state = createGame({ seed: SEED });
    const grid = makeFlatNavGrid(10, 10);
    blockColumn(grid, 1); // isolates x >= 2 from the employee at x = 0
    state.navGrid = grid;
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng, 0, 0);

    const action = makeAction({ id: 1, targetX: 5, targetZ: 5, requiredSkill: 'blasting' });
    state.pendingActions.push(action);

    tickEmployees(state);

    // Unreachable this tick — must not be claimed, and must not be marked in
    // any way that would prevent a later retry.
    expect(state.pendingActions.find(a => a.id === 1)!.status).toBe('queued');
    expect(state.pendingActions.find(a => a.id === 1)!.holderId).toBeNull();
    expect(employee.activeActionId).toBeNull();

    // Open the path — same action, now reachable.
    grid.cells[5]![1] = { type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false };

    tickEmployees(state);

    expect(state.pendingActions.find(a => a.id === 1)!.holderId).toBe(employee.id);
  });

  it("queue advances to the next entry recomputed from where the previous task actually ended, not from the employee's original position", () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(30, 30);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng, 0, 0);

    // A finishes at (10,0). From there, B (10,10) is closer (dist 10) than
    // C (0,10) (dist ~14.1) — but from the ORIGINAL position (0,0), C
    // (dist 10) is closer than B (dist ~14.1). Fixing the order at claim
    // time (from the original position) would pick C next; recomputing from
    // the actual end position picks B.
    const actionA = makeAction({ id: 1, targetX: 10, targetZ: 0, requiredSkill: 'blasting', payload: { durationTicks: 1 } });
    const actionB = makeAction({ id: 2, targetX: 10, targetZ: 10, requiredSkill: 'blasting', payload: { durationTicks: 1 } });
    const actionC = makeAction({ id: 3, targetX: 0, targetZ: 10, requiredSkill: 'blasting', payload: { durationTicks: 1 } });
    // Insertion order deliberately does not match the expected pick order.
    state.pendingActions.push(actionC, actionB, actionA);

    let aCompleted = false;
    for (let i = 0; i < 60; i++) {
      runFullTick(state);
      if (!aCompleted && !state.pendingActions.find(a => a.id === 1)) aCompleted = true;
      if (aCompleted && employee.activeActionId !== null) break;
    }

    expect(employee.activeActionId).toBe(2); // B, not C
  });

  it('reserves at most MAX_EMPLOYEE_TASK_QUEUE_DEPTH actions ahead for one employee, leaving the rest for someone else', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(30, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng, 0, 0);

    const total = MAX_EMPLOYEE_TASK_QUEUE_DEPTH + 2;
    const actions: PendingAction[] = [];
    for (let i = 1; i <= total; i++) {
      // Long work duration — nothing completes during the settle loop below,
      // isolating the reservation cap from completion/re-dispatch timing.
      actions.push(makeAction({ id: i, targetX: i, targetZ: 0, requiredSkill: 'blasting', payload: { durationTicks: 100 } }));
    }
    state.pendingActions.push(...actions);

    // Settle dispatch across several ticks without letting anything complete.
    for (let i = 0; i < 10; i++) {
      tickEmployees(state);
      tickLocomotion(state);
      tickArrivalGate(state);

      const heldByEmployee = state.pendingActions.filter(
        a => a.holderId === employee.id && a.status !== 'queued',
      );
      expect(heldByEmployee.length).toBeLessThanOrEqual(MAX_EMPLOYEE_TASK_QUEUE_DEPTH);
      expect(employee.taskQueue.length).toBeLessThanOrEqual(MAX_EMPLOYEE_TASK_QUEUE_DEPTH);
    }

    const heldByEmployee = state.pendingActions.filter(
      a => a.holderId === employee.id && a.status !== 'queued',
    );
    // The single employee is the only one who could ever hold more than one
    // of these — proves dispatch actually reserves ahead (not just the one
    // active slot) while still respecting the cap.
    expect(heldByEmployee.length).toBeGreaterThan(1);
    expect(employee.taskQueue.length).toBeGreaterThan(0);

    const stillQueued = state.pendingActions.filter(a => a.status === 'queued');
    expect(stillQueued.length).toBeGreaterThanOrEqual(total - MAX_EMPLOYEE_TASK_QUEUE_DEPTH);
  });

  it("collapse releases only the active action back to queued/holderId:null — the employee's remaining taskQueue survives untouched", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    // Manually construct the "mid-task with a reserved queue" shape #549
    // dispatch produces — isolates tickCollapse's release behavior from the
    // dispatch logic that builds this shape.
    const active = makeAction({ id: 1, status: 'in_progress', holderId: employee.id });
    const queuedA = makeAction({ id: 2, targetX: 1, targetZ: 1, status: 'assigned', holderId: employee.id });
    const queuedB = makeAction({ id: 3, targetX: 2, targetZ: 2, status: 'assigned', holderId: employee.id });
    state.pendingActions.push(active, queuedA, queuedB);
    employee.activeActionId = active.id;
    employee.taskTicksRemaining = 5;
    employee.taskQueue = [queuedA.id, queuedB.id];

    // Trigger collapse via fatigue at the hard threshold.
    employee.fatigue = NEED_HARD_THRESHOLDS.fatigue;

    tickCollapse(state);

    // The active action is released — queued, unheld, not deleted — so it
    // can be reclaimed later (mirrors cancelAction's release pattern,
    // TaskDispatch.ts, #548).
    const releasedActive = state.pendingActions.find(a => a.id === 1);
    expect(releasedActive).toBeDefined();
    expect(releasedActive!.status).toBe('queued');
    expect(releasedActive!.holderId).toBeNull();

    // Remaining not-yet-started queue entries are untouched by the
    // interruption — only the active slot releases (#549 decision: taskQueue
    // survives interruption).
    expect(employee.taskQueue).toEqual([queuedA.id, queuedB.id]);
    const stillReservedA = state.pendingActions.find(a => a.id === 2)!;
    const stillReservedB = state.pendingActions.find(a => a.id === 3)!;
    expect(stillReservedA.status).toBe('assigned');
    expect(stillReservedA.holderId).toBe(employee.id);
    expect(stillReservedB.status).toBe('assigned');
    expect(stillReservedB.holderId).toBe(employee.id);
  });

  it('#816: an idle employee whose own taskQueue holds one permanently-unreachable action falls through to the open pool instead of freezing forever', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(30, 5);
    blockColumn(state.navGrid, 3); // walls off x>=3 from the employee's own column
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng, 0, 0);

    // Simulates the exact stale shape #816 traced (autoInsertNeedTasks
    // inserting a targeted 'rest' action whose 'rest in place' target later
    // becomes unreachable, e.g. a place_building footprint closing over it):
    // an already-'assigned', still-holderId-matching action sitting in this
    // employee's own taskQueue, whose target is unreachable this tick and
    // every tick after (not a one-tick fluke — genuinely walled off).
    const staleQueued = makeAction({
      id: 1, targetX: 10, targetZ: 0, status: 'assigned', holderId: employee.id,
    });
    const openPoolCandidate = makeAction({ id: 2, targetX: 1, targetZ: 0 });
    state.pendingActions.push(staleQueued, openPoolCandidate);
    employee.taskQueue = [staleQueued.id];

    // Before the fix, fillIdleEmployeeFromQueueOrPool returned as soon as the
    // one taskQueue candidate came back unreachable, never trying the open
    // pool at all — the employee stayed idle forever with a fully claimable
    // action sitting untouched right next to them.
    for (let i = 0; i < 5; i++) {
      tickEmployees(state);
      tickLocomotion(state);
      tickArrivalGate(state);
      if (employee.activeActionId === openPoolCandidate.id) break;
    }

    expect(employee.activeActionId).toBe(openPoolCandidate.id);
    const pool = state.pendingActions.find(a => a.id === openPoolCandidate.id)!;
    // 'assigned' (claimed, still walking) or 'in_progress' (already arrived
    // and working, reachable target is one cell away) — either proves the
    // fall-through claimed it, not which tick within the settle loop did so.
    expect(['assigned', 'in_progress']).toContain(pool.status);
    expect(pool.holderId).toBe(employee.id);

    // The stale entry is retried, not dropped — still sitting in
    // pendingActions/taskQueue, available to resume automatically if its
    // target ever becomes reachable again (a blast reopening it, etc.).
    const stale = state.pendingActions.find(a => a.id === staleQueued.id)!;
    expect(stale.status).toBe('assigned');
    expect(stale.holderId).toBe(employee.id);
  });
});

describe('tickEmployees — task duration seeding on claim (Ch.3 skill progression, issue #406)', () => {
  const SEED = 42;

  function makeSkillAction(
    overrides: Partial<PendingAction> & { id: number; targetEmployeeId: number | null },
  ): PendingAction {
    return {
      type: 'general_work',
      requiredSkill: 'blasting',
      requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: {},
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
      ...overrides,
    };
  }

  it('seeds taskTicksRemaining from BASE_TASK_DURATION_TICKS scaled by proficiency, need, and living-quarters multipliers', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    // A driller arrives holding 'blasting' at Rookie (level 1); a blaster starts at level 2.
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    expect(employee.taskTicksRemaining).toBeNull();

    state.pendingActions.push(makeSkillAction({ id: 1, targetEmployeeId: employee.id }));
    tickEmployees(state);
    resolveArrival(state);

    expect(employee.activeActionId).toBe(1);
    const needMult = getNeedMultiplier(employee);
    const lqMult = getLivingQuartersWellbeingMultiplier(state.buildings, state.employees.employees.length);
    const expected = computeTaskDuration(BASE_TASK_DURATION_TICKS, 1, needMult, lqMult, 1);

    expect(employee.taskTicksRemaining).toBe(expected);
  });

  it('higher proficiency yields a strictly shorter seeded duration than Rookie for the identical task', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee: rookie } = hireEmployee(state.employees, 'driller', rng); // stays level 1
    const { employee: master } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, master.id, 'blasting', 5);

    state.pendingActions.push(makeSkillAction({ id: 1, targetEmployeeId: rookie.id }));
    state.pendingActions.push(makeSkillAction({ id: 2, targetEmployeeId: master.id }));
    tickEmployees(state);
    resolveArrival(state);

    expect(rookie.taskTicksRemaining).not.toBeNull();
    expect(master.taskTicksRemaining).not.toBeNull();
    expect(master.taskTicksRemaining!).toBeLessThan(rookie.taskTicksRemaining!);

    const needMult = getNeedMultiplier(rookie);
    const lqMult = getLivingQuartersWellbeingMultiplier(state.buildings, state.employees.employees.length);
    expect(rookie.taskTicksRemaining).toBe(computeTaskDuration(BASE_TASK_DURATION_TICKS, 1, needMult, lqMult, 1));
    expect(master.taskTicksRemaining).toBe(computeTaskDuration(BASE_TASK_DURATION_TICKS, 5, needMult, lqMult, 1));
  });

  it('an exhausted employee is seeded a longer duration than a well-rested one — combined modifiers apply', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee: fed } = hireEmployee(state.employees, 'blaster', rng);
    const { employee: exhausted } = hireEmployee(state.employees, 'blaster', rng);
    exhausted.fatigue = 20; // below NEED_THRESHOLDS.fatigue.low (40) → productivity penalty

    state.pendingActions.push(makeSkillAction({ id: 1, targetEmployeeId: fed.id }));
    state.pendingActions.push(makeSkillAction({ id: 2, targetEmployeeId: exhausted.id }));
    tickEmployees(state);
    resolveArrival(state);

    expect(fed.taskTicksRemaining).not.toBeNull();
    expect(exhausted.taskTicksRemaining).not.toBeNull();
    expect(exhausted.taskTicksRemaining!).toBeGreaterThan(fed.taskTicksRemaining!);
  });

  it('rest actions remain seeded through restTicksRemaining, never taskTicksRemaining (regression)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);

    state.pendingActions.push({
      id: 1, type: 'rest', requiredSkill: null, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { needKey: 'fatigue', restDuration: 5 },
      targetEmployeeId: employee.id,
      status: 'queued', holderId: null,
      queuedAtTick: 0,
    });
    tickEmployees(state);
    resolveArrival(state);

    expect(employee.restTicksRemaining).toBe(5);
    expect(employee.taskTicksRemaining).toBeNull();
  });
});

describe('tickEmployees — vehicle-gated actions (#550)', () => {
  const SEED = 42;

  function makeVehicleGatedAction(
    overrides: Partial<PendingAction> & { id: number },
  ): PendingAction {
    return {
      type: 'general_work',
      requiredSkill: 'blasting',
      requiredVehicleRole: 'drill_rig',
      targetX: 20, targetZ: 20, targetY: 0,
      payload: {},
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
      ...overrides,
    };
  }

  it('stays queued (in result.waiting, not result.unqualified/claimed) when a qualified employee exists but no free licensed vehicle does', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng); // has 'blasting' already
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    // No vehicle purchased at all — nothing to reserve.

    const action = makeVehicleGatedAction({ id: 1 });
    state.pendingActions.push(action);

    const result = tickEmployees(state);

    expect(state.pendingActions.find(a => a.id === 1)!.status).toBe('queued');
    expect(result.waiting).toContain(1);
    expect(result.unqualified).not.toContain(1);
    expect(result.claimed).not.toContain(1);
    expect(employee.activeActionId).toBeNull();
  });

  it('claims exactly one of two equally qualified idle employees when only one licensed vehicle is free, and reserves that vehicle for the action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee: empA } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, empA.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { employee: empB } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, empB.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    const action = makeVehicleGatedAction({ id: 1 });
    state.pendingActions.push(action);

    tickEmployees(state);

    const claimers = [empA, empB].filter(e => e.activeActionId === action.id);
    expect(claimers).toHaveLength(1);
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBe(action.id);
  });

  it('promotes a claimed vehicle-gated action onto pendingDriverVehicleId (walk-to-vehicle), not pendingTaskDuration/taskTicksRemaining directly', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    const action = makeVehicleGatedAction({ id: 1, targetEmployeeId: employee.id });
    state.pendingActions.push(action);

    tickEmployees(state);

    expect(employee.activeActionId).toBe(action.id);
    expect(employee.pendingDriverVehicleId).toBe(vehicle.id);
    // Work duration is seeded later, on the VEHICLE's arrival at the
    // target — not here, at claim time.
    expect(employee.pendingTaskDuration).toBeNull();
    expect(employee.taskTicksRemaining).toBeNull();
  });

  it('falls through a nearer vehicle-gated action with no free vehicle and claims a farther, unblocked one instead of staying idle (#552)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    // No drill_rig vehicle purchased — the nearer action can never be claimed
    // right now, but this must not stall the employee for the whole tick.

    const nearButBlocked = makeVehicleGatedAction({ id: 1, targetX: 2, targetZ: 2 });
    const farButClaimable = makeVehicleGatedAction({
      id: 2, targetX: 25, targetZ: 25, requiredVehicleRole: null,
    });
    state.pendingActions.push(nearButBlocked, farButClaimable);

    tickEmployees(state);

    expect(state.pendingActions.find(a => a.id === 1)!.status).toBe('queued');
    expect(state.pendingActions.find(a => a.id === 2)!.holderId).toBe(employee.id);
    expect(employee.activeActionId).toBe(2);
  });

  // ── #611: isClaimable pre-filter starvation ─────────────────────────────
  //
  // The #552 fallthrough above only skips an unclaimable candidate WITHIN
  // the bounded top-N loop (selectBestActionForEmployee's `continue`) — that
  // `continue` still consumes one of the ACTION_SELECTION_MAX_PATH_ATTEMPTS
  // attempts. A backlog of more than ACTION_SELECTION_MAX_PATH_ATTEMPTS
  // unlicensed vehicle-gated actions, all cheaper-ranked than one licensed
  // drill action, burns the whole budget and leaves the employee idle.

  it('does not let an unlicensed haul backlog larger than the attempt budget starve a farther, licensed drill action (#611)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0); // has 'blasting' already
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    // No debris_hauler vehicle purchased at all, and the employee holds no
    // ROLE_LICENCE_REQUIRED.debris_hauler licence either — findVehicleForClaim
    // can never succeed for any of the haul actions below.

    const unlicensedHauls: PendingAction[] = [];
    for (let i = 1; i <= 8; i++) {
      unlicensedHauls.push({
        id: i,
        type: 'general_work',
        requiredSkill: null,
        requiredVehicleRole: 'debris_hauler',
        targetX: i, targetZ: 0, targetY: 0,
        payload: {},
        targetEmployeeId: null,
        status: 'queued',
        holderId: null,
        queuedAtTick: 0,
      });
    }

    // Farther (higher estimated cost) than every haul candidate, but the
    // employee is both qualified (blasting) and licensed (drill_rig) for it,
    // and a free drill_rig vehicle exists.
    const drillAction = makeVehicleGatedAction({ id: 100 });
    state.pendingActions.push(...unlicensedHauls, drillAction);

    tickEmployees(state);

    expect(employee.activeActionId).toBe(drillAction.id);
    expect(state.pendingActions.find(a => a.id === drillAction.id)!.holderId).toBe(employee.id);
  });

  // #1110: an employee mid-forced-rest (restTicksRemaining set, walking to or
  // already at a shift-boundary rest — ForceShiftRest.ts) has activeActionId
  // set to the rest action's own id, so without the isMidCollapseOrForcedRest
  // guard in EmployeeDispatch.ts's tickEmployees, claimActionsTargetedAtEmployee
  // would still reclaim a targeted action for them every tick — pushing it
  // onto taskQueue (since activeActionId !== null) and reserving its vehicle
  // for nobody to board, tripping I5_reservation_without_valid_holder — same
  // shape as the #1042 mid-evacuation-drive case above, for the shift-rest
  // trigger instead.
  it('an employee mid-forced-rest does not claim a targeted vehicle-gated action, and does not reserve its vehicle (#1110)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    // Mid-forced-rest: restTicksRemaining set, activeActionId pointed at the
    // rest action itself (mirrors ForceShiftRest.ts's completeRestForEmployee
    // shape) — reads exactly like a busy-but-claimable employee to
    // claimActionsTargetedAtEmployee without the guard.
    employee.restTicksRemaining = 50;
    employee.activeActionId = 999;

    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    const action = makeVehicleGatedAction({ id: 1, targetEmployeeId: employee.id });
    state.pendingActions.push(action);

    tickEmployees(state);

    expect(employee.taskQueue).not.toContain(action.id);
    expect(state.pendingActions.find(a => a.id === action.id)!.status).toBe('queued');
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
  });

  // #1339: a rest and a vehicle-gated action both targeted at one idle
  // employee are claimed in the same pass (rest first). The rest is promoted
  // to active, then the vehicle-gated claim used to push onto taskQueue and
  // reserve a vehicle nobody boards for the whole rest (I5).
  it('an idle employee with a targeted rest and a targeted vehicle-gated action rests first and does not reserve the vehicle (#1339)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    const rest: PendingAction = {
      id: 1, type: 'rest', requiredSkill: null, requiredVehicleRole: null,
      targetX: employee.x, targetZ: employee.z, targetY: 0, payload: {},
      targetEmployeeId: employee.id, status: 'queued', holderId: null, queuedAtTick: 0,
    };
    const drill = makeVehicleGatedAction({ id: 2, targetEmployeeId: employee.id });
    state.pendingActions.push(rest, drill);

    tickEmployees(state);

    expect(employee.activeActionId).toBe(rest.id);
    expect(employee.taskQueue).not.toContain(drill.id);
    expect(state.pendingActions.find(a => a.id === drill.id)!.status).toBe('queued');
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
  });

  // Mirror case: an ordinary employee (not resting, not collapsing) is
  // unaffected by the #1110 guard and still claims a targeted vehicle-gated
  // action normally — already proven above by 'promotes a claimed
  // vehicle-gated action onto pendingDriverVehicleId (walk-to-vehicle) ...',
  // which uses this same makeVehicleGatedAction + targetEmployeeId shape with
  // no rest/collapse fields set.
});

// ═══════════════════════════════════════════════════════════════════════════
// #1061 — blockedReason classification: a queued PendingAction that sits with
// nobody able to perform it right now gets a light, non-blocking diagnosis
// (BlockedOrderReason) recomputed every tick — surfaced via the action's own
// `blockedReason` field. Vehicle-gated actions are deliberately never added
// to result.unqualified (see EmployeeDispatch.ts's own comment on that
// pre-existing heavy channel) but MUST get a `blockedReason` once this lands.
// The order itself is never cancelled — status stays 'queued' throughout.
// ═══════════════════════════════════════════════════════════════════════════

describe('tickEmployees — blockedReason classification (#1061)', () => {
  const SEED = 42;

  function makeLevelGroundAction(overrides: Partial<PendingAction> & { id: number }): PendingAction {
    return {
      type: 'level_ground',
      requiredSkill: 'driving.excavator',
      requiredVehicleRole: 'rock_digger',
      targetX: 5, targetZ: 5, targetY: 0,
      payload: {},
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
      ...overrides,
    };
  }

  it('flags no_vehicle_in_fleet on a level_ground order when a licensed employee exists but no rock_digger vehicle is owned anywhere', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, 'driving.excavator', 1);
    // No vehicle purchased at all — state.vehicles.vehicles stays empty.

    const action = makeLevelGroundAction({ id: 1 });
    state.pendingActions.push(action);

    const result = tickEmployees(state);

    expect(state.pendingActions.find(a => a.id === 1)!.blockedReason).toBe('no_vehicle_in_fleet');
    // Vehicle-gated actions never enter the heavy unqualified_task_error channel.
    expect(result.unqualified).not.toContain(1);
    // The order itself is never cancelled/refused — stays queued.
    expect(state.pendingActions.find(a => a.id === 1)!.status).toBe('queued');
  });

  it('flags no_licensed_driver on a level_ground order when a rock_digger vehicle exists but nobody on the roster is licensed to drive one', () => {
    const state = createGame({ seed: SEED });
    purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    // No employees hired at all — nobody could ever hold the licence.

    const action = makeLevelGroundAction({ id: 1 });
    state.pendingActions.push(action);

    const result = tickEmployees(state);

    expect(state.pendingActions.find(a => a.id === 1)!.blockedReason).toBe('no_licensed_driver');
    expect(result.unqualified).not.toContain(1);
    expect(state.pendingActions.find(a => a.id === 1)!.status).toBe('queued');
  });

  it('leaves blockedReason falsy on a level_ground order once a rock_digger vehicle and a licensed, eligible employee both exist', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, 'driving.excavator', 1);
    purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);

    const action = makeLevelGroundAction({ id: 1 });
    state.pendingActions.push(action);

    tickEmployees(state);

    const stored = state.pendingActions.find(a => a.id === 1)!;
    // Optional field — null/undefined both mean "not blocked" (GameState.ts's
    // own doc comment on PendingAction.blockedReason: always read with `!=
    // null`, never `!==`). Assert it is not one of the three reason strings
    // rather than pinning down which of the two falsy spellings is used.
    const reasons: unknown[] = ['no_qualified_employee', 'no_vehicle_in_fleet', 'no_licensed_driver'];
    expect(reasons).not.toContain(stored.blockedReason);
  });

  it('flags no_qualified_employee for a skill-gated (non-vehicle) action nobody on the roster can perform, recording it in result.unqualified', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    // Not 'driller': ROLE_STARTING_QUALIFICATIONS grants a fresh driller hire
    // 'blasting' by default (Employee.ts), so that role would already be
    // qualified for the action below. 'surveyor' starts with 'geology'.
    const { employee } = hireEmployee(state.employees, 'surveyor', rng);
    assignSkill(state.employees, employee.id, 'driving.truck', 1); // wrong skill for the action below

    const action: PendingAction = {
      id: 1, type: 'drill_hole', requiredSkill: 'blasting', requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0,
    };
    state.pendingActions.push(action);

    const result = tickEmployees(state);

    expect(result.unqualified).toContain(1);
    expect(state.pendingActions.find(a => a.id === 1)!.blockedReason).toBe('no_qualified_employee');
    expect(state.pendingActions.find(a => a.id === 1)!.status).toBe('queued');
  });

  it('flags no_qualified_employee on a vehicle-gated drill_hole order when the only licensed driver lacks the required skill, then clears once an employee holds BOTH', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    // 'surveyor' starts with 'geology' only (ROLE_STARTING_QUALIFICATIONS) — no
    // 'blasting', so licensing them for drill_rig alone must not satisfy the
    // conjunction the new gate requires.
    const { employee } = hireEmployee(state.employees, 'surveyor', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    const action: PendingAction = {
      id: 1, type: 'drill_hole', requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig',
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0,
    };
    state.pendingActions.push(action);

    tickEmployees(state);

    expect(state.pendingActions.find(a => a.id === 1)!.blockedReason).toBe('no_qualified_employee');
    expect(state.pendingActions.find(a => a.id === 1)!.status).toBe('queued');

    // Same employee now also holds the required skill — licensed AND qualified.
    assignSkill(state.employees, employee.id, 'blasting', 1);

    tickEmployees(state);

    const reasons: unknown[] = ['no_qualified_employee', 'no_dual_qualified_employee', 'no_vehicle_in_fleet', 'no_licensed_driver'];
    expect(reasons).not.toContain(state.pendingActions.find(a => a.id === 1)!.blockedReason);
  });

  it('flags no_dual_qualified_employee (no modal) when the skill and the licence sit on different employees, then clears once one employee holds both (#1386)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    // #1339: a driller now arrives WITH the drill_rig licence, so the skill-only
    // holder here is a blaster ('blasting', no drill_rig licence).
    const { employee: driller } = hireEmployee(state.employees, 'blaster', rng);
    const { employee: driver } = hireEmployee(state.employees, 'driver', rng);
    assignSkill(state.employees, driver.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    for (const id of [1, 2]) {
      state.pendingActions.push({
        id, type: 'drill_hole', requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig',
        targetX: id, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null,
        status: 'queued', holderId: null, queuedAtTick: 0,
      });
    }

    const result = tickEmployees(state);

    for (const id of [1, 2]) {
      const stored = state.pendingActions.find(a => a.id === id)!;
      expect(stored.blockedReason).toBe('no_dual_qualified_employee');
      expect(stored.status).toBe('queued');
      expect(result.unqualified).not.toContain(id);
    }

    // The driller now also holds the licence.
    assignSkill(state.employees, driller.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    tickEmployees(state);

    const reasons: unknown[] = ['no_qualified_employee', 'no_dual_qualified_employee', 'no_vehicle_in_fleet', 'no_licensed_driver'];
    for (const id of [1, 2]) {
      expect(reasons).not.toContain(state.pendingActions.find(a => a.id === id)?.blockedReason);
    }
  });

  it('regression: result.unqualified still reports an action nobody on the roster is qualified for, unchanged by the new blocked channel (mirrors pre-#1061 coverage)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, 'driving.truck', 1);

    const action: PendingAction = {
      id: 3, type: 'drill_hole', requiredSkill: 'geology', requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0,
    };
    state.pendingActions.push(action);

    const result = tickEmployees(state);

    expect(result.unqualified).toContain(3);
    expect(state.pendingActions).toHaveLength(1);
  });
});

// #1090: VehicleContinuity.ts's completeVehicleGatedActionIfApplicable (and the #1000/#1002
// starvation-override/taskQueue-vehicle-release describe blocks that used to live here,
// testing it directly) is deleted. findStarvedActionForEmployee itself still exists
// and is covered directly in ActionSelection.test.ts; starvation now wins dispatch
// purely through the normal cost-ranked pool, with no dedicated vehicle-gated
// completion fast path to test here any more.

// ═══════════════════════════════════════════════════════════════════════════
// #1306 — per-action, per-actor reachability. A queued action's ghost is red
// (GhostPreview.unreachable) when none of the actors able to perform THAT
// action can reach its target, or no such actor exists. Replaces the #1231
// depot anchor (nearest active freight_warehouse): no building is needed for
// any case below, and the `target_unreachable` blocked-order reason follows
// the same per-actor verdict. Decision review #1272: a red order is still
// accepted, charged and left queued — never refused or cancelled.
// ═══════════════════════════════════════════════════════════════════════════

describe('queued-order reachability — per-actor red rule (#1306)', () => {
  const SEED = 42;

  // Column WALL_X is fully 'blocked' across every row, disconnecting REGION_A
  // (x < WALL_X) from REGION_B (x > WALL_X) for walkers and vehicles alike.
  const WIDTH = 20;
  const HEIGHT = 10;
  const WALL_X = 8;
  const IN_A = { x: 3, z: 5 };
  const IN_A_TARGET = { x: 6, z: 6 };
  const IN_B = { x: 14, z: 5 };
  const IN_B_TARGET = { x: 15, z: 7 };

  function makeGrid(opts: { wall?: boolean; narrowColumn?: number } = {}): NavGrid {
    const { wall = true, narrowColumn } = opts;
    const cells: NavCell[][] = [];
    for (let z = 0; z < HEIGHT; z++) {
      const row: NavCell[] = [];
      for (let x = 0; x < WIDTH; x++) {
        const blocked = wall && x === WALL_X;
        const cell: NavCell = { type: blocked ? 'blocked' : 'walkable', moveCost: blocked ? Infinity : 1.0, benchLevel: 0, vehicleOccupied: false };
        // Fits a walker (clearance 1) but not a vehicle (clearance 2).
        if (x === narrowColumn) cell.clearance = NAV_CLEARANCE_EMPLOYEE_CELLS;
        row.push(cell);
      }
      cells.push(row);
    }
    return new NavGrid(WIDTH, HEIGHT, cells);
  }

  function makeState(opts: { wall?: boolean; narrowColumn?: number } = {}): GameState {
    const state = createGame({ seed: SEED });
    state.navGrid = makeGrid(opts);
    return state;
  }

  function hire(state: GameState, at: { x: number; z: number }, skills: string[] = []) {
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED + state.employees.nextId), at.x, at.z);
    // A hired driver arrives holding the excavator licence; each test grants its own.
    employee.qualifications = employee.qualifications.filter(q => q.category !== 'driving.excavator');
    for (const skill of skills) assignSkill(state.employees, employee.id, skill as never, 1);
    return employee;
  }

  function queue(
    state: GameState,
    type: PendingAction['type'],
    at: { x: number; z: number },
    extra: Partial<Omit<PendingAction, 'id' | 'type' | 'targetX' | 'targetZ' | 'targetY'>> = {},
  ): number {
    const id = state.nextPendingActionId++;
    const result = dispatchPendingAction(state, {
      id, type,
      requiredSkill: null, requiredVehicleRole: null,
      targetX: at.x, targetZ: at.z, targetY: 0,
      payload: {}, targetEmployeeId: null,
      ...extra,
    }, { skipQualificationCheck: true });
    expect(result.success).toBe(true);
    return id;
  }

  const queueDig = (state: GameState, at: { x: number; z: number }) =>
    queue(state, 'level_ground', at, { requiredSkill: 'driving.excavator', requiredVehicleRole: 'rock_digger' });

  const ghost = (state: GameState, id: number) => state.ghostPreviews.find(g => g.id === id)!;
  const isRed = (state: GameState, id: number) => ghost(state, id).unreachable === true;

  describe('on-foot actions (no skill, no vehicle)', () => {
    it('is red when no employee exists at all', () => {
      const state = makeState();
      const id = queue(state, 'survey', IN_A_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);
      // Never refused or cancelled — stays queued (#1272).
      expect(state.pendingActions.find(a => a.id === id)!.status).toBe('queued');
    });

    it('is blue when an employee can walk to the target', () => {
      const state = makeState();
      hire(state, IN_A);
      const id = queue(state, 'survey', IN_A_TARGET);
      refreshOrderReachability(state);
      expect(ghost(state, id).unreachable).toBe(false);
    });

    it('is red when the only employee is walled off from the target, and stamps target_unreachable', () => {
      const state = makeState();
      hire(state, IN_A);
      const id = queue(state, 'survey', IN_B_TARGET);
      tickEmployees(state);
      expect(isRed(state, id)).toBe(true);
      expect(state.pendingActions.find(a => a.id === id)!.blockedReason).toBe('target_unreachable');
      expect(state.pendingActions.find(a => a.id === id)!.status).toBe('queued');
    });

    it('is blue when one of several employees has access, though the others do not', () => {
      const state = makeState();
      hire(state, IN_A);
      hire(state, IN_A);
      hire(state, IN_B);
      const id = queue(state, 'survey', IN_B_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
    });

    it('does not depend on a freight_warehouse: an active depot in region A does not make a region-B employee unable to reach region B', () => {
      const state = makeState();
      const placed = placeBuilding(state.buildings, 'freight_warehouse', 1, 1, WIDTH, HEIGHT);
      if (!placed.success) throw new Error(`Setup: placeBuilding failed — ${placed.error}`);
      placed.building!.active = true;
      hire(state, IN_B);
      const id = queue(state, 'survey', IN_B_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
    });

    it('is judged with no depot anywhere (the old check never ran without one)', () => {
      const state = makeState();
      hire(state, IN_A);
      const id = queue(state, 'survey', IN_B_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);
    });

    it('never throws and leaves a ghost not red when state.navGrid is null', () => {
      const state = makeState();
      state.navGrid = null;
      hire(state, IN_A);
      const id = queue(state, 'survey', IN_B_TARGET);
      expect(() => refreshOrderReachability(state)).not.toThrow();
      expect(isRed(state, id)).toBe(false);
    });
  });

  describe('temporary unavailability keeps an actor (stays blue)', () => {
    it.each([
      ['injured', (e: { injured: boolean }) => { e.injured = true; }],
      ['resting', (e: { restTicksRemaining: number | null }) => { e.restTicksRemaining = 10; }],
      ['collapsing', (e: { collapsing: boolean }) => { e.collapsing = true; }],
      ['busy with other work', (e: { activeActionId: number | null }) => { e.activeActionId = 9999; }],
    ])('an %s employee still counts', (_label, mutate) => {
      const state = makeState();
      const emp = hire(state, IN_B);
      mutate(emp as never);
      const id = queue(state, 'survey', IN_B_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
    });

    it('an employee in training still counts', () => {
      const state = makeState();
      const emp = hire(state, IN_B);
      emp.trainingState = { courseId: 'x', ticksRemaining: 50 } as never;
      const id = queue(state, 'survey', IN_B_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
    });

    it('a dead employee no longer counts (blue -> red)', () => {
      const state = makeState();
      const emp = hire(state, IN_B);
      const id = queue(state, 'survey', IN_B_TARGET);
      expect(isRed(state, id)).toBe(false);
      killEmployee(state.employees, emp.id);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);
    });

    it('a fired employee no longer counts (blue -> red)', () => {
      const state = makeState();
      const emp = hire(state, IN_B);
      const id = queue(state, 'survey', IN_B_TARGET);
      expect(fireEmployee(state.employees, emp.id).success).toBe(true);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);
    });

    it('a destroyed vehicle no longer counts (blue -> red) and a bought one does (red -> blue)', () => {
      const state = makeState();
      hire(state, IN_B, [ROLE_LICENCE_REQUIRED.rock_digger, 'driving.excavator']);
      const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', IN_B.x, IN_B.z);
      const id = queueDig(state, IN_B_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);

      destroyVehicle(state.vehicles, vehicle.id);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);

      purchaseVehicle(state.vehicles, 'rock_digger', IN_B.x, IN_B.z);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
    });
  });

  describe('skill-gated actions', () => {
    it('is red when nobody holds the required skill, even with a reachable employee', () => {
      const state = makeState();
      hire(state, IN_A); // a plain driver: no 'blasting'
      const id = queue(state, 'drill_hole', IN_A_TARGET, { requiredSkill: 'blasting' });
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);
    });

    it('is blue once a reachable employee holds the skill, red when only a walled-off one does', () => {
      const state = makeState();
      hire(state, IN_A);
      const skilled = hire(state, IN_B, ['blasting']);
      const id = queue(state, 'drill_hole', IN_A_TARGET, { requiredSkill: 'blasting' });
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);

      skilled.x = IN_A.x;
      skilled.z = IN_A.z;
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
    });
  });

  describe('vehicle-gated actions', () => {
    const LICENCE = ROLE_LICENCE_REQUIRED.rock_digger;

    it('is blue when a licensed, skilled employee and a rock_digger both reach the target', () => {
      const state = makeState();
      hire(state, IN_A, [LICENCE, 'driving.excavator']);
      purchaseVehicle(state.vehicles, 'rock_digger', IN_A.x + 1, IN_A.z);
      const id = queueDig(state, IN_A_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
    });

    it('is red with no vehicle of the role, no licensed employee, or an employee lacking the required skill', () => {
      const noVehicle = makeState();
      hire(noVehicle, IN_A, [LICENCE, 'driving.excavator']);
      const a = queueDig(noVehicle, IN_A_TARGET);
      refreshOrderReachability(noVehicle);
      expect(isRed(noVehicle, a)).toBe(true);

      const noDriver = makeState();
      purchaseVehicle(noDriver.vehicles, 'rock_digger', IN_A.x, IN_A.z);
      const b = queueDig(noDriver, IN_A_TARGET);
      refreshOrderReachability(noDriver);
      expect(isRed(noDriver, b)).toBe(true);

      const unskilled = makeState();
      purchaseVehicle(unskilled.vehicles, 'rock_digger', IN_A.x, IN_A.z);
      hire(unskilled, IN_A, ['driving.truck']);
      const c = queueDig(unskilled, IN_A_TARGET);
      refreshOrderReachability(unskilled);
      expect(isRed(unskilled, c)).toBe(true);
    });

    it('is red when the vehicle cannot drive to the target even though the employee can walk there', () => {
      const state = makeState();
      hire(state, IN_A, [LICENCE, 'driving.excavator']);
      purchaseVehicle(state.vehicles, 'rock_digger', IN_A.x, IN_A.z);
      const id = queueDig(state, IN_B_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);
    });

    it('is red when the employee cannot get to the vehicle', () => {
      const state = makeState();
      hire(state, IN_A, [LICENCE, 'driving.excavator']);
      purchaseVehicle(state.vehicles, 'rock_digger', IN_B.x, IN_B.z);
      const id = queueDig(state, IN_B_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);
    });

    it('is blue when the employee is already aboard a vehicle that can drive to the target', () => {
      const state = makeState();
      const emp = hire(state, IN_B, [LICENCE, 'driving.excavator']);
      const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', IN_B.x, IN_B.z);
      expect(board(state, vehicle.id, emp.id).success).toBe(true);
      const id = queueDig(state, IN_B_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
    });

    it('is blue when any one licensed employee/vehicle pairing has access among several that do not', () => {
      const state = makeState();
      hire(state, IN_A, [LICENCE, 'driving.excavator']);
      hire(state, IN_B, [LICENCE, 'driving.excavator']);
      purchaseVehicle(state.vehicles, 'rock_digger', IN_A.x, IN_A.z);
      purchaseVehicle(state.vehicles, 'rock_digger', IN_B.x, IN_B.z);
      const id = queueDig(state, IN_B_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
    });

    it('stamps debris_out_of_reach (never target_unreachable) on a stranded auto-generated haul_debris order', () => {
      const state = makeState();
      hire(state, IN_A, [ROLE_LICENCE_REQUIRED.debris_hauler]);
      purchaseVehicle(state.vehicles, 'debris_hauler', IN_A.x, IN_A.z);
      const id = queue(state, 'haul_debris', IN_B_TARGET, { requiredVehicleRole: 'debris_hauler', payload: { fragmentId: 1 } });
      tickEmployees(state);
      expect(isRed(state, id)).toBe(true);
      expect(state.pendingActions.find(a => a.id === id)!.blockedReason).toBe('debris_out_of_reach');
    });
  });

  describe('same target, different actor sets, different colours', () => {
    it('a cell a walker reaches through a narrow corridor but no vehicle fits is blue for a survey and red for a rock_digger order', () => {
      const state = makeState({ wall: false, narrowColumn: WALL_X });
      hire(state, IN_A, [ROLE_LICENCE_REQUIRED.rock_digger, 'driving.excavator']);
      purchaseVehicle(state.vehicles, 'rock_digger', IN_A.x, IN_A.z);
      const survey = queue(state, 'survey', IN_B_TARGET);
      const dig = queueDig(state, IN_B_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, survey)).toBe(false);
      expect(isRed(state, dig)).toBe(true);
    });

    it('a skill only a walled-off employee holds: the same cell is blue for a skill-free order and red for the skilled one', () => {
      const state = makeState();
      hire(state, IN_A);
      hire(state, IN_B, ['geology']);
      const free = queue(state, 'survey', IN_A_TARGET);
      const gated = queue(state, 'survey', IN_A_TARGET, { requiredSkill: 'geology' });
      refreshOrderReachability(state);
      expect(isRed(state, free)).toBe(false);
      expect(isRed(state, gated)).toBe(true);
    });
  });

  describe('targeted actions (targetEmployeeId)', () => {
    it('is red when the named employee cannot reach the target, though another employee could', () => {
      const state = makeState();
      const named = hire(state, IN_B);
      hire(state, IN_A);
      const id = queue(state, 'rest', IN_A_TARGET, { targetEmployeeId: named.id });
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);
    });

    it('is blue when the named employee reaches the target even though nobody else does', () => {
      const state = makeState();
      const named = hire(state, IN_B);
      const id = queue(state, 'rest', IN_B_TARGET, { targetEmployeeId: named.id });
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
    });

    it('is red when the named employee has died or been fired, though others could reach it', () => {
      const state = makeState();
      const named = hire(state, IN_A);
      hire(state, IN_A);
      const id = queue(state, 'rest', IN_A_TARGET, { targetEmployeeId: named.id });
      killEmployee(state.employees, named.id);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);
    });
  });

  describe('new orders are classified the moment dispatchPendingAction returns (no tick)', () => {
    it('an unreachable order is born red and a reachable one born blue', () => {
      const state = makeState();
      hire(state, IN_A);
      const red = queue(state, 'survey', IN_B_TARGET);
      const blue = queue(state, 'survey', IN_A_TARGET);
      expect(ghost(state, red).unreachable).toBe(true);
      expect(ghost(state, blue).unreachable).toBe(false);
    });

    it('bumps ghostPreviewsRevision when the order is added', () => {
      const state = makeState();
      const before = state.ghostPreviewsRevision;
      queue(state, 'survey', IN_B_TARGET);
      expect(state.ghostPreviewsRevision).toBeGreaterThan(before);
    });

    it('a place_building ghost carries the ordered building type, tier and footprint origin', () => {
      const state = makeState();
      // A real order registers its plannedBuilding before dispatching (buildOrder.ts).
      state.plannedBuildings.push({
        id: 1, buildingId: 1, type: 'management_office', tier: 2, x: 4, z: 4, actionId: 7, cost: 0,
      });
      dispatchPendingAction(state, {
        id: 7, type: 'place_building', requiredSkill: null, requiredVehicleRole: null,
        targetX: IN_A_TARGET.x, targetZ: IN_A_TARGET.z, targetY: 0,
        payload: { buildingOrderId: 1, footprint: [[0, 0], [1, 0], [0, 1], [1, 1]] },
        targetEmployeeId: null,
      }, { skipQualificationCheck: true });
      expect(ghost(state, 7).building).toEqual({ type: 'management_office', tier: 2, x: 4, z: 4 });
    });

    it('a non-building ghost carries no building', () => {
      const state = makeState();
      const id = queue(state, 'survey', IN_A_TARGET);
      expect(ghost(state, id).building).toBeUndefined();
    });
  });

  describe('claimed ghosts are never red', () => {
    it('an assigned action stays blue though no actor can reach it any more', () => {
      const state = makeState();
      const emp = hire(state, IN_A);
      const id = queue(state, 'survey', IN_A_TARGET);
      expect(claimPendingAction(state, id, emp.id)).not.toBeNull();
      killEmployee(state.employees, emp.id);
      refreshOrderReachability(state);
      expect(ghost(state, id).claimed).toBe(true);
      expect(isRed(state, id)).toBe(false);
    });

    it('an in_progress action in an unreachable area is not red', () => {
      const state = makeState();
      const emp = hire(state, IN_A);
      const id = queue(state, 'survey', IN_B_TARGET);
      claimPendingAction(state, id, emp.id);
      state.pendingActions.find(a => a.id === id)!.status = 'in_progress';
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
    });

    it('a red ghost turns blue the moment it is claimed', () => {
      const state = makeState();
      const emp = hire(state, IN_A);
      const id = queue(state, 'survey', IN_B_TARGET);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);
      claimPendingAction(state, id, emp.id);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
    });
  });

  describe('ghostPreviewsRevision bumps only when a verdict flips', () => {
    it('stays put across repeated refreshes with nothing changed', () => {
      const state = makeState();
      hire(state, IN_A);
      queue(state, 'survey', IN_B_TARGET);
      queue(state, 'survey', IN_A_TARGET);
      refreshOrderReachability(state);
      const rev = state.ghostPreviewsRevision;
      refreshOrderReachability(state);
      refreshOrderReachability(state);
      expect(state.ghostPreviewsRevision).toBe(rev);
    });

    it('bumps exactly when a colour flips, in both directions', () => {
      const state = makeState();
      const emp = hire(state, IN_B);
      const id = queue(state, 'survey', IN_B_TARGET);
      refreshOrderReachability(state);
      const rev0 = state.ghostPreviewsRevision;

      killEmployee(state.employees, emp.id);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(true);
      const rev1 = state.ghostPreviewsRevision;
      expect(rev1).toBeGreaterThan(rev0);

      hire(state, IN_B);
      refreshOrderReachability(state);
      expect(isRed(state, id)).toBe(false);
      expect(state.ghostPreviewsRevision).toBeGreaterThan(rev1);
    });
  });

  describe('tickEmployees keeps the colour current (within one tick)', () => {
    it('flips red -> blue the tick after a wall cell is opened (a ramp connects the area)', () => {
      const state = makeState();
      hire(state, IN_A);
      const id = queue(state, 'survey', IN_B_TARGET);
      tickEmployees(state);
      expect(isRed(state, id)).toBe(true);

      state.navGrid!.setCellAt(WALL_X, 5, { type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
      tickEmployees(state);
      expect(isRed(state, id)).toBe(false);
      expect(state.pendingActions.find(a => a.id === id)!.blockedReason).not.toBe('target_unreachable');
    });

    it('flips blue -> red the tick after a wall cell is closed (a footprint cuts the area off)', () => {
      const state = makeState({ wall: false });
      const emp = hire(state, IN_A);
      emp.injured = true; // keep the employee from claiming the order mid-test
      const id = queue(state, 'survey', IN_B_TARGET);
      tickEmployees(state);
      expect(isRed(state, id)).toBe(false);

      for (let z = 0; z < HEIGHT; z++) {
        state.navGrid!.setCellAt(WALL_X, z, { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false });
      }
      tickEmployees(state);
      expect(isRed(state, id)).toBe(true);
    });
  });

  describe('ramps: the verdict of the next layer to dig applies to every queued layer', () => {
    function queueRamp(
      state: GameState,
      layerTargets: Array<{ x: number; z: number }>,
      doneFlags: boolean[] = [],
    ): number[] {
      const ids = layerTargets.map((at, index) => queue(state, 'dig_ramp_segment', at, {
        requiredSkill: 'driving.excavator',
        requiredVehicleRole: 'rock_digger',
        payload: { rampId: 1, segmentIndex: index, cells: [], region: null },
      }));
      const ramp: PlannedRamp = {
        id: 1,
        def: { originX: 0, originZ: 0, direction: 'south', length: layerTargets.length, targetDepth: 6 },
        footprint: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
        segments: layerTargets.map((_, index): RampSegmentTracker => ({
          index, actionId: ids[index]!, cells: [], region: null, done: doneFlags[index] ?? false,
        })),
      };
      state.plannedRamps.push(ramp);
      return ids;
    }

    function staffDiggers(state: GameState, at: { x: number; z: number }): void {
      hire(state, at, [ROLE_LICENCE_REQUIRED.rock_digger, 'driving.excavator']);
      purchaseVehicle(state.vehicles, 'rock_digger', at.x, at.z);
    }

    it('a ramp on an unreachable area is red on every layer', () => {
      const state = makeState();
      staffDiggers(state, IN_A);
      const ids = queueRamp(state, [IN_B_TARGET, IN_B_TARGET, IN_B_TARGET]);
      refreshOrderReachability(state);
      for (const id of ids) expect(isRed(state, id)).toBe(true);
    });

    it('a reachable ramp is blue on every layer', () => {
      const state = makeState();
      staffDiggers(state, IN_A);
      const ids = queueRamp(state, [IN_A_TARGET, IN_A_TARGET, IN_A_TARGET]);
      refreshOrderReachability(state);
      for (const id of ids) expect(isRed(state, id)).toBe(false);
    });

    it('layers waiting behind a half-dug layer never read red because of it (next layer reachable, deeper layers not)', () => {
      const state = makeState();
      staffDiggers(state, IN_A);
      // Layer 0 reachable; layers 1 and 2 sit across the wall — exactly the
      // transient "1 m step" unreachability the gradual carve leaves (#946).
      const ids = queueRamp(state, [IN_A_TARGET, IN_B_TARGET, IN_B_TARGET]);
      refreshOrderReachability(state);
      for (const id of ids) expect(isRed(state, id)).toBe(false);
    });

    it('one reachable deeper layer does not rescue a ramp whose next layer is unreachable', () => {
      const state = makeState();
      staffDiggers(state, IN_A);
      const ids = queueRamp(state, [IN_B_TARGET, IN_A_TARGET, IN_A_TARGET]);
      refreshOrderReachability(state);
      for (const id of ids) expect(isRed(state, id)).toBe(true);
    });

    it('once the top layer is done the verdict comes from the next not-done layer', () => {
      const state = makeState();
      staffDiggers(state, IN_A);
      const ids = queueRamp(state, [IN_A_TARGET, IN_B_TARGET, IN_A_TARGET], [true, false, false]);
      // Layer 0's action is gone once done.
      state.pendingActions = state.pendingActions.filter(a => a.id !== ids[0]);
      state.ghostPreviews = state.ghostPreviews.filter(g => g.id !== ids[0]);
      refreshOrderReachability(state);
      expect(isRed(state, ids[1]!)).toBe(true);
      expect(isRed(state, ids[2]!)).toBe(true);
    });

    it('a claimed layer is never red, while the queued layers behind it follow the ramp verdict', () => {
      const state = makeState();
      staffDiggers(state, IN_A);
      const ids = queueRamp(state, [IN_B_TARGET, IN_B_TARGET, IN_B_TARGET]);
      claimPendingAction(state, ids[0]!, state.employees.employees[0]!.id);
      refreshOrderReachability(state);
      expect(isRed(state, ids[0]!)).toBe(false);
      expect(isRed(state, ids[1]!)).toBe(true);
      expect(isRed(state, ids[2]!)).toBe(true);
    });

    it('a ramp turns blue on every layer once its area is connected', () => {
      const state = makeState();
      staffDiggers(state, IN_A);
      const ids = queueRamp(state, [IN_B_TARGET, IN_B_TARGET]);
      refreshOrderReachability(state);
      expect(ids.every(id => isRed(state, id))).toBe(true);
      state.navGrid!.setCellAt(WALL_X, 5, { type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
      refreshOrderReachability(state);
      expect(ids.every(id => !isRed(state, id))).toBe(true);
    });

    it('the unreachable-ramp order is still accepted and left queued, never started', () => {
      const state = makeState();
      staffDiggers(state, IN_A);
      const ids = queueRamp(state, [IN_B_TARGET, IN_B_TARGET]);
      for (let i = 0; i < 5; i++) tickEmployees(state);
      for (const id of ids) expect(state.pendingActions.find(a => a.id === id)!.status).toBe('queued');
    });
  });
});


describe('drill_hole actions — dispatch and landing (#553)', () => {
  const SEED = 42;

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

  function makeDriller(state: GameState, rng: Random, x: number, z: number) {
    const { employee } = hireEmployee(state.employees, 'driller', rng, x, z);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    return employee;
  }

  function queueDrillHoleAction(state: GameState, hole: PlannedHole, durationTicks = 3): void {
    dispatchPendingAction(state, {
      id: state.nextPendingActionId++,
      type: 'drill_hole',
      requiredSkill: 'blasting',
      requiredVehicleRole: 'drill_rig',
      targetX: hole.x,
      targetZ: hole.z,
      targetY: 0,
      payload: { holeId: hole.id, x: hole.x, z: hole.z, depth: hole.depth, diameter: hole.diameter, durationTicks },
      targetEmployeeId: null,
    }, { skipQualificationCheck: true });
  }

  /**
   * One full dispatch -> movement -> arrival -> work-tick pass, mirroring the
   * real tick command (events.ts) but trimmed to what this suite exercises.
   * On completion of a drill_hole action, performs the same landing step the
   * console tick pipeline is expected to (#1090): completeVehicleGatedAction
   * releases the vehicle-gated action's own reservation (claim-only — the
   * driver stays mounted; any same-role follow-up is picked up through the
   * planner's own cost-ranked dispatch on a later tick, not a dedicated
   * continuity fast path here), then the completed hole moves from
   * plannedDrillHoles into drillHoles via landDrilledHole. Returns the ids of
   * holes that landed this tick, in completion order.
   */
  function runFullTickAndLandDrilledHoles(state: GameState): string[] {
    tickEmployees(state);
    tickLocomotion(state);
    tickArrivalGate(state);

    const landed: string[] = [];
    for (const emp of state.employees.employees) {
      if (!emp.alive) continue;
      const progress = tickTaskProgress(state, emp);
      if (!progress?.completed || progress.actionId === undefined) continue;

      const completingAction = state.pendingActions.find(a => a.id === progress.actionId);
      const holeId = completingAction?.payload['holeId'] as string | undefined;

      if (completingAction && completingAction.requiredVehicleRole !== null) {
        completeVehicleGatedAction(state, emp, progress.actionId);
      } else {
        completePendingAction(state, progress.actionId);
      }

      if (holeId !== undefined) {
        const idx = state.plannedDrillHoles.findIndex(h => h.id === holeId);
        if (idx !== -1) {
          const [planned] = state.plannedDrillHoles.splice(idx, 1);
          state.drillHoles.push(landDrilledHole(planned!));
          landed.push(holeId);
        }
      }
    }
    return landed;
  }

  it('two drillers with drill_rigs each land a distinct nearest hole out of three — no double-claim, none drilled twice', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(40, 5);
    const rng = new Random(SEED);

    makeDriller(state, rng, 0, 0);
    makeDriller(state, rng, 30, 0);
    purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    purchaseVehicle(state.vehicles, 'drill_rig', 30, 0);

    const planned: PlannedHole[] = [
      { id: 'H1', x: 2, z: 0, depth: 8, diameter: 0.15 },
      { id: 'H2', x: 28, z: 0, depth: 8, diameter: 0.15 },
      { id: 'H3', x: 15, z: 0, depth: 8, diameter: 0.15 },
    ];
    state.plannedDrillHoles.push(...planned);
    for (const hole of planned) queueDrillHoleAction(state, hole);

    const landed: string[] = [];
    for (let i = 0; i < 400 && landed.length < 3; i++) {
      landed.push(...runFullTickAndLandDrilledHoles(state));
    }

    expect(landed).toHaveLength(3);
    expect(new Set(landed).size).toBe(3);
    expect(state.drillHoles.map(h => h.id).sort()).toEqual(['H1', 'H2', 'H3']);
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(0);
  });

  it('a single driller with one drill_rig lands three holes one at a time, nearest-first — not simultaneously', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(40, 5);
    const rng = new Random(SEED);

    makeDriller(state, rng, 0, 0);
    purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    // Distances from (0,0): H3 (5) nearest, H1 (20) middle, H2 (30) farthest.
    const planned: PlannedHole[] = [
      { id: 'H1', x: 20, z: 0, depth: 8, diameter: 0.15 },
      { id: 'H2', x: 30, z: 0, depth: 8, diameter: 0.15 },
      { id: 'H3', x: 5, z: 0, depth: 8, diameter: 0.15 },
    ];
    state.plannedDrillHoles.push(...planned);
    for (const hole of planned) queueDrillHoleAction(state, hole);

    const landedOrder: string[] = [];
    let sawSimultaneousInProgress = false;
    for (let i = 0; i < 400 && landedOrder.length < 3; i++) {
      const inProgressCount = state.pendingActions.filter(
        a => a.type === 'drill_hole' && a.status === 'in_progress',
      ).length;
      if (inProgressCount > 1) sawSimultaneousInProgress = true;

      landedOrder.push(...runFullTickAndLandDrilledHoles(state));
    }

    expect(sawSimultaneousInProgress).toBe(false);
    // Landed one at a time (never more than one per tick call above), and
    // nearest-first, recomputed from wherever the rig actually ends up after
    // each hole — not fixed at initial dispatch time (mirrors #549's own
    // "queue advances ... recomputed from where the previous task actually
    // ended" behavior, exercised here for drill_hole specifically).
    expect(landedOrder).toEqual(['H3', 'H1', 'H2']);
  });
});

describe('charge_hole actions — dispatch and landing (#554)', () => {
  const SEED = 42;

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

  function makeBlaster(state: GameState, rng: Random, x: number, z: number) {
    const { employee } = hireEmployee(state.employees, 'blaster', rng, x, z);
    return employee;
  }

  function queueChargeHoleAction(state: GameState, hole: DrillHole, durationTicks = 3): void {
    state.plannedChargesByHole[hole.id] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
    dispatchPendingAction(state, {
      id: state.nextPendingActionId++,
      type: 'charge_hole',
      requiredSkill: 'blasting',
      requiredVehicleRole: null,
      targetX: hole.x,
      targetZ: hole.z,
      targetY: 0,
      payload: {
        holeId: hole.id, explosiveId: 'boomite', amountKg: 5, stemmingM: 2, durationTicks,
      },
      targetEmployeeId: null,
    }, { skipQualificationCheck: true });
  }

  /**
   * One full dispatch -> movement -> arrival -> work-tick pass, mirroring
   * runFullTickAndLandDrilledHoles above but landing charge_hole completions
   * instead: moves the completed hole's PlannedCharge out of
   * plannedChargesByHole and into chargesByHole via landLoadedCharge.
   * charge_hole carries requiredVehicleRole: null, so no vehicle-continuity
   * promotion step applies here. Returns the ids of holes that landed this
   * tick, in completion order.
   */
  function runFullTickAndLandLoadedCharges(state: GameState): string[] {
    tickEmployees(state);
    tickLocomotion(state);
    tickArrivalGate(state);

    const landed: string[] = [];
    for (const emp of state.employees.employees) {
      if (!emp.alive) continue;
      const progress = tickTaskProgress(state, emp);
      if (!progress?.completed || progress.actionId === undefined) continue;

      const completingAction = state.pendingActions.find(a => a.id === progress.actionId);
      const holeId = completingAction?.payload['holeId'] as string | undefined;

      completePendingAction(state, progress.actionId);

      if (holeId !== undefined) {
        const planned = state.plannedChargesByHole[holeId];
        if (planned) {
          delete state.plannedChargesByHole[holeId];
          state.chargesByHole[holeId] = landLoadedCharge(planned);
          landed.push(holeId);
        }
      }
    }
    return landed;
  }

  it('two blasters each claim a distinct nearest hole out of three — no hole double-queued, no two in-progress actions share one blaster', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(40, 5);
    const rng = new Random(SEED);

    makeBlaster(state, rng, 0, 0);
    makeBlaster(state, rng, 30, 0);

    const holes: DrillHole[] = [
      { id: 'H1', x: 2, z: 0, depth: 8, diameter: 0.15 },
      { id: 'H2', x: 28, z: 0, depth: 8, diameter: 0.15 },
      { id: 'H3', x: 15, z: 0, depth: 8, diameter: 0.15 },
    ];
    state.drillHoles.push(...holes);
    for (const hole of holes) queueChargeHoleAction(state, hole);

    const landed: string[] = [];
    let sawTwoInProgressOnSameEmployee = false;
    for (let i = 0; i < 400 && landed.length < 3; i++) {
      for (const emp of state.employees.employees) {
        const inProgressForEmp = state.pendingActions.filter(
          a => a.type === 'charge_hole' && a.status === 'in_progress' && a.holderId === emp.id,
        ).length;
        if (inProgressForEmp > 1) sawTwoInProgressOnSameEmployee = true;
      }
      landed.push(...runFullTickAndLandLoadedCharges(state));
    }

    expect(sawTwoInProgressOnSameEmployee).toBe(false);
    expect(landed).toHaveLength(3);
    expect(new Set(landed).size).toBe(3);
    expect(Object.keys(state.chargesByHole).sort()).toEqual(['H1', 'H2', 'H3']);
    expect(Object.keys(state.plannedChargesByHole)).toHaveLength(0);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
  });

  it('a single blaster loads three holes one at a time, nearest-first — never two charge_hole actions in progress simultaneously', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(40, 5);
    const rng = new Random(SEED);

    makeBlaster(state, rng, 0, 0);

    // Distances from (0,0): H3 (5) nearest, H1 (20) middle, H2 (30) farthest.
    const holes: DrillHole[] = [
      { id: 'H1', x: 20, z: 0, depth: 8, diameter: 0.15 },
      { id: 'H2', x: 30, z: 0, depth: 8, diameter: 0.15 },
      { id: 'H3', x: 5, z: 0, depth: 8, diameter: 0.15 },
    ];
    state.drillHoles.push(...holes);
    for (const hole of holes) queueChargeHoleAction(state, hole);

    const landedOrder: string[] = [];
    let sawSimultaneousInProgress = false;
    for (let i = 0; i < 400 && landedOrder.length < 3; i++) {
      const inProgressCount = state.pendingActions.filter(
        a => a.type === 'charge_hole' && a.status === 'in_progress',
      ).length;
      if (inProgressCount > 1) sawSimultaneousInProgress = true;

      landedOrder.push(...runFullTickAndLandLoadedCharges(state));
    }

    expect(sawSimultaneousInProgress).toBe(false);
    expect(landedOrder).toEqual(['H3', 'H1', 'H2']);
  });
});

describe('dig_ramp_segment actions — vehicle-gated dispatch and driving.excavator gate (#555)', () => {
  const SEED = 42;

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

  function makeExcavatorDriver(state: GameState, rng: Random, x: number, z: number) {
    const { employee } = hireEmployee(state.employees, 'driver', rng, x, z);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.rock_digger, 1);
    return employee;
  }

  // dig_ramp_segment's own work-duration is derived from payload.cells.length
  // (voxelCount) and the reserved vehicle's tier via
  // computeRampSegmentDurationTicks (ActionSelection.ts) — unlike drill_hole/
  // charge_hole, it ignores a flat payload.durationTicks entirely. voxelCount
  // defaults to enough cells (3 ticks' worth at tier 1's
  // RAMP_DIG_VOXELS_PER_TICK_TIER1 = 8/tick) that a single tickTaskProgress
  // call mid-task can be observed decrementing rather than immediately
  // completing the segment.
  function queueDigRampSegmentAction(state: GameState, targetX: number, targetZ: number, voxelCount = 24): number {
    const id = state.nextPendingActionId++;
    const cells = Array.from({ length: voxelCount }, (_, i) => ({ x: targetX, y: -i, z: targetZ }));
    dispatchPendingAction(state, {
      id,
      type: 'dig_ramp_segment',
      requiredSkill: 'driving.excavator',
      requiredVehicleRole: 'rock_digger',
      targetX, targetZ, targetY: 0,
      payload: { rampId: 1, segmentIndex: 0, cells, region: null },
      targetEmployeeId: null,
    }, { skipQualificationCheck: true });
    return id;
  }

  it('taskTicksRemaining only counts down once a driving.excavator-qualified employee is aboard a reserved rock_digger at the segment target', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(40, 5);
    const rng = new Random(SEED);

    const employee = makeExcavatorDriver(state, rng, 0, 0);
    purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);

    queueDigRampSegmentAction(state, 10, 0);

    // Claim: pendingTaskDuration/taskTicksRemaining stay null — the work
    // timer only seeds once the vehicle has actually arrived at the target,
    // mirroring the drill_hole/charge_hole vehicle-gated claim tests above.
    tickEmployees(state);
    expect(employee.activeActionId).not.toBeNull();
    expect(employee.taskTicksRemaining).toBeNull();

    // Drive the employee -> vehicle -> target arrival loop until the work
    // timer is finally seeded.
    let seededAt = -1;
    for (let i = 0; i < 100 && employee.taskTicksRemaining === null; i++) {
      tickLocomotion(state);
      tickArrivalGate(state);
      if (employee.taskTicksRemaining !== null) seededAt = i;
    }
    expect(seededAt).toBeGreaterThanOrEqual(0);

    const before = employee.taskTicksRemaining!;
    tickTaskProgress(state, employee);
    expect(employee.taskTicksRemaining).toBe(before - 1);
  });

  it('an employee without driving.excavator never claims a dig_ramp_segment action, even with a free rock_digger available', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(40, 5);
    const rng = new Random(SEED);

    // Hired with an unrelated driving licence — no driving.excavator.
    const { employee } = hireEmployee(state.employees, 'driver', rng, 0, 0);
    employee.qualifications = employee.qualifications.filter(q => q.category !== 'driving.excavator');
    assignSkill(state.employees, employee.id, 'driving.truck', 1);
    purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);

    const actionId = queueDigRampSegmentAction(state, 10, 0);

    const result = tickEmployees(state);

    expect(employee.activeActionId).toBeNull();
    expect(state.pendingActions.find(a => a.id === actionId)!.status).toBe('queued');
    expect(result.claimed).not.toContain(actionId);
  });
});

// #925: RampSegmentDef's `index` became a LAYER index (0 = topmost bench,
// increasing = deeper), not a column index — defineRampSegments now groups
// cells by absolute Y instead of by (x,z) column. isRampSegmentClaimable's
// own logic is unchanged (it only ever compared `index` values, generically
// "is the previous segment done"), so these tests still pass unmodified —
// they're re-read/relabelled here per #925's own instruction, since "segment
// N-1" now concretely means "the bench immediately above", not "the
// previous column along the ramp's length".
describe('isRampSegmentClaimable (#555, relabelled for layer semantics — #925)', () => {
  function makeAction(overrides: Partial<PendingAction> & { id: number }): PendingAction {
    return {
      type: 'dig_ramp_segment',
      requiredSkill: 'driving.excavator',
      requiredVehicleRole: 'rock_digger',
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { rampId: 1, segmentIndex: 0 },
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
      ...overrides,
    };
  }

  function makeTracker(index: number, actionId: number, done: boolean): RampSegmentTracker {
    return { index, actionId, cells: [], region: null, done };
  }

  it('segment index 0 is claimable when no PlannedRamp tracking exists yet (fail-open)', () => {
    const state = createGame({ seed: 1 });
    // No plannedRamps at all — nothing to gate on.
    const action = makeAction({ id: 1, payload: { rampId: 99, segmentIndex: 0 } });

    expect(isRampSegmentClaimable(state, action)).toBe(true);
  });

  it('segment index 0 is claimable — genuinely the ramp\'s own entrance, no prior segment', () => {
    const state = createGame({ seed: 1 });
    const plannedRamp: PlannedRamp = {
      id: 1,
      def: { originX: 0, originZ: 0, direction: 'south', length: 3, targetDepth: 6 },
      footprint: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      segments: [
        makeTracker(0, 10, false),
        makeTracker(1, 11, false),
        makeTracker(2, 12, false),
      ],
    };
    state.plannedRamps.push(plannedRamp);
    const action = makeAction({ id: 10, payload: { rampId: 1, segmentIndex: 0 } });

    expect(isRampSegmentClaimable(state, action)).toBe(true);
  });

  it('segment index N > 0 is NOT claimable while segment N - 1 is not yet done — a lower bench is not claimable while the layer above it has unfinished work', () => {
    const state = createGame({ seed: 1 });
    const plannedRamp: PlannedRamp = {
      id: 1,
      def: { originX: 0, originZ: 0, direction: 'south', length: 3, targetDepth: 6 },
      footprint: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      segments: [
        makeTracker(0, 10, false), // topmost bench (layer 0) not yet done
        makeTracker(1, 11, false),
        makeTracker(2, 12, false),
      ],
    };
    state.plannedRamps.push(plannedRamp);
    const action = makeAction({ id: 11, payload: { rampId: 1, segmentIndex: 1 } });

    expect(isRampSegmentClaimable(state, action)).toBe(false);
  });

  it('segment index N > 0 IS claimable once segment N - 1 is done', () => {
    const state = createGame({ seed: 1 });
    const plannedRamp: PlannedRamp = {
      id: 1,
      def: { originX: 0, originZ: 0, direction: 'south', length: 3, targetDepth: 6 },
      footprint: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      segments: [
        makeTracker(0, 10, true), // segment 0 done
        makeTracker(1, 11, false),
        makeTracker(2, 12, false),
      ],
    };
    state.plannedRamps.push(plannedRamp);
    const action = makeAction({ id: 11, payload: { rampId: 1, segmentIndex: 1 } });

    expect(isRampSegmentClaimable(state, action)).toBe(true);
  });

  it('a later segment (index 2) stays unclaimable while its immediate predecessor (index 1) is undone, even if segment 0 is done', () => {
    const state = createGame({ seed: 1 });
    const plannedRamp: PlannedRamp = {
      id: 1,
      def: { originX: 0, originZ: 0, direction: 'south', length: 3, targetDepth: 6 },
      footprint: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      segments: [
        makeTracker(0, 10, true),
        makeTracker(1, 11, false), // immediate predecessor of segment 2, not done
        makeTracker(2, 12, false),
      ],
    };
    state.plannedRamps.push(plannedRamp);
    const action = makeAction({ id: 12, payload: { rampId: 1, segmentIndex: 2 } });

    expect(isRampSegmentClaimable(state, action)).toBe(false);
  });
});

describe('isChargeHoleClaimable (#1342)', () => {
  function makeAction(type: PendingAction['type'], payload: Record<string, unknown>): PendingAction {
    return {
      id: 1, type,
      requiredSkill: 'blasting', requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload,
      targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0,
    };
  }

  it('is false for a charge_hole whose hole is still only planned (drill order not landed)', () => {
    const state = createGame({ seed: 1 });
    state.plannedDrillHoles.push({ id: 'H7', x: 3, z: 3, depth: 6, diameter: 0.15 } as never);
    expect(isChargeHoleClaimable(state, makeAction('charge_hole', { holeId: 'H7' }))).toBe(false);
  });

  it('is true for a charge_hole whose hole is not planned (already drilled)', () => {
    const state = createGame({ seed: 1 });
    state.drillHoles.push({ id: 'H7', x: 3, z: 3, depth: 6, diameter: 0.15 });
    expect(isChargeHoleClaimable(state, makeAction('charge_hole', { holeId: 'H7' }))).toBe(true);
  });

  it('is true for a charge_hole naming an unknown hole', () => {
    const state = createGame({ seed: 1 });
    expect(isChargeHoleClaimable(state, makeAction('charge_hole', { holeId: 'nope' }))).toBe(true);
  });

  it('is true for other action types even when their holeId is planned', () => {
    const state = createGame({ seed: 1 });
    state.plannedDrillHoles.push({ id: 'H7', x: 3, z: 3, depth: 6, diameter: 0.15 } as never);
    expect(isChargeHoleClaimable(state, makeAction('drill_hole', { holeId: 'H7' }))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// employeeWorkState (#680, extended to 'traveling' by #928)
//
// The travel-drain fix (#928): walking a fixed distance to a claimed job
// (pendingTaskDuration !== null) and walking the same distance back to rest
// (pendingRestDuration !== null) must drain fatigue by the SAME amount — both
// now bill at the 'traveling' tier, rather than 'working' for the outbound
// leg and 'idle' for the return leg. employeeWorkState is the single
// function NEED_DRAIN_RATES tier selection reads, so pinning its four
// branches here is what proves the fix rather than merely proving intent.
// ─────────────────────────────────────────────────────────────────────────────
describe('employeeWorkState (#680, #928)', () => {
  const SEED = 42;

  function makeIdleEmployee(state: GameState) {
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    return employee;
  }

  it('returns "resting" whenever restTicksRemaining is set, regardless of any other field', () => {
    const state = createGame({ seed: SEED });
    const employee = makeIdleEmployee(state);
    employee.restTicksRemaining = 3;
    employee.activeActionId = 7; // must not override — resting takes priority

    expect(employeeWorkState(employee)).toBe('resting');
  });

  it('returns "traveling" when pendingTaskDuration is set (outbound walk to a claimed job)', () => {
    const state = createGame({ seed: SEED });
    const employee = makeIdleEmployee(state);
    employee.activeActionId = 7;
    employee.pendingTaskDuration = 12; // walking to the job, not yet arrived

    expect(employeeWorkState(employee)).toBe('traveling');
  });

  it('returns "traveling" when pendingRestDuration is set (return-to-rest walk)', () => {
    const state = createGame({ seed: SEED });
    const employee = makeIdleEmployee(state);
    employee.pendingRestDuration = 8; // walking to living_quarters, not yet arrived

    expect(employeeWorkState(employee)).toBe('traveling');
  });

  it('returns "working" only once activeActionId is set with no pending duration (arrived, timer seeded)', () => {
    const state = createGame({ seed: SEED });
    const employee = makeIdleEmployee(state);
    employee.activeActionId = 7;
    employee.taskTicksRemaining = 12; // ArrivalGate already promoted the timer
    // pendingTaskDuration/pendingRestDuration both null — the arrived state.

    expect(employeeWorkState(employee)).toBe('working');
  });

  it('returns "idle" when nothing is claimed and nothing is pending', () => {
    const state = createGame({ seed: SEED });
    const employee = makeIdleEmployee(state);

    expect(employeeWorkState(employee)).toBe('idle');
  });

  // A vehicle-gated action's pendingTaskDuration is set-and-immediately-
  // promoted atomically at vehicle arrival (ArrivalGate.ts's vehicle-drive
  // loop: seedTaskTimerFields followed in the same tick, same block, by
  // taskTicksRemaining = duration; pendingTaskDuration = null — never
  // observably left non-null across a tick boundary for this action family).
  // With no itinerary and destinationX/Z left unset either (the synthetic
  // case below — not a state a real employee reaches, since boarding and
  // mid-drive both run through moveTo/itinerary, see the next test), this
  // still falls through to 'working' with no other signal to read.
  it('activeActionId alone, no itinerary/destination, yields "working"', () => {
    const state = createGame({ seed: SEED });
    const employee = makeIdleEmployee(state);
    employee.activeActionId = 9; // claimed a vehicle-gated action
    employee.pendingDriverVehicleId = 3; // mid-walk to board — not itself consulted by employeeWorkState
    // pendingTaskDuration is never set for this family until the vehicle
    // arrives, and is cleared in the very same step that seeds it.

    expect(employeeWorkState(employee)).toBe('working');
  });

  // #1090 livelock follow-up (#1123): a vehicle-gated action's own approach
  // drive — claimed, not yet arrived, so pendingTaskDuration/taskTicksRemaining
  // both stay null the whole way (ArrivalGate.ts's own deferral, #1089) — was
  // misread as 'working' by the fallback above, because pendingTaskDuration is
  // the ONLY "still travelling" signal the on-foot case (#928) ever needed.
  // A mounted, itinerary-driven drive never sets that field, so the mid-drive
  // phase silently drained fatigue at the 'working' rate (2/tick) instead of
  // 'traveling' (1/tick) — confirmed live via needs.integration.test.ts's own
  // #945 box-cut suite: a mounted forced-rest round trip billed at double the
  // intended rate blew straight through the fatigue budget every time,
  // producing a permanent livelock with no distance cap involved at all.
  // itinerary (or, for the legacy foot-walk fallback, destinationX/Z — see
  // beginRestTravel's own doc comment, RestActionHelpers.ts) is non-null for
  // exactly the same "not yet arrived" window ArrivalGate.tickArrivalGate's
  // own `arrived` check already reads, so it closes the gap the same way
  // pendingTaskDuration does for the on-foot case.
  it('returns "traveling" for a claimed, not-yet-arrived vehicle-gated action (itinerary set, no pendingTaskDuration)', () => {
    const state = createGame({ seed: SEED });
    const employee = makeIdleEmployee(state);
    employee.activeActionId = 9; // claimed a vehicle-gated action, mid-drive
    employee.itinerary = { legs: [], goal: { kind: 'reposition', x: 12, z: 34 }, workTicks: 0, estTotalTicks: 10 };
    // pendingTaskDuration/taskTicksRemaining both null — not yet arrived.

    expect(employeeWorkState(employee)).toBe('traveling');
  });

  // Synthetic construction, not a real code path: destinationX/Z are a
  // read-only derived mirror of itinerary (#1178), with no production writer
  // of their own (enforced by tests/unit/lint/SingleMovementEntry.test.ts).
  // Setting them directly here exercises employeeWorkState's read of that
  // mirror in isolation, the same way the itinerary-set test above exercises
  // the itinerary side.
  it('returns "traveling" when destinationX/Z are set directly on a synthetic employee (mirror read path, no itinerary)', () => {
    const state = createGame({ seed: SEED });
    const employee = makeIdleEmployee(state);
    employee.activeActionId = 9;
    employee.destinationX = 12;
    employee.destinationZ = 34;

    expect(employeeWorkState(employee)).toBe('traveling');
  });
});
