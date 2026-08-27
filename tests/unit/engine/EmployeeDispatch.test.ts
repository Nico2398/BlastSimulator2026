// BlastSimulator2026 — Tests for employee dispatch: claim logic, cost-based
// dispatch, vehicle-gated actions, and the drill_hole/charge_hole/
// dig_ramp_segment action families (relocated from GameLoop.test.ts, #759).

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { tickEmployees } from '../../../src/core/engine/EmployeeDispatch.js';
import { tickCollapse } from '../../../src/core/engine/NeedRestoration.js';
import { tickTaskProgress } from '../../../src/core/engine/TaskProgress.js';
import { tickArrivalGate } from '../../../src/core/engine/ArrivalGate.js';
import { tickEmployeeMovement } from '../../../src/core/engine/EntityMovementTick.js';
import { completePendingAction, dispatchPendingAction } from '../../../src/core/engine/TaskDispatch.js';
import { releaseVehicleOnCompletion } from '../../../src/core/engine/VehicleReservation.js';
import { tryContinueVehicleGatedAction } from '../../../src/core/engine/VehicleContinuity.js';
import { isRampSegmentClaimable } from '../../../src/core/engine/ActionSelection.js';
import {
  hireEmployee, assignSkill, getNeedMultiplier, computeTaskDuration,
} from '../../../src/core/entities/Employee.js';
import type { PendingAction, PlannedRamp, RampSegmentTracker } from '../../../src/core/state/GameState.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { landDrilledHole, type PlannedHole } from '../../../src/core/mining/DrillPlan.js';
import { landLoadedCharge } from '../../../src/core/mining/ChargePlan.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import { getLivingQuartersWellbeingMultiplier } from '../../../src/core/entities/BuildingWellbeing.js';
import {
  BASE_TASK_DURATION_TICKS,
  MAX_EMPLOYEE_TASK_QUEUE_DEPTH,
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
  tickEmployeeMovement(state);
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
    tickEmployeeMovement(state);
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
      tickEmployeeMovement(state);
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

    // Trigger collapse via hunger below the collapse threshold.
    employee.hunger = 1;
    employee.fatigue = 100;
    employee.breakNeed = 100;

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
      ...overrides,
    };
  }

  it('seeds taskTicksRemaining from BASE_TASK_DURATION_TICKS scaled by proficiency, need, and living-quarters multipliers', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    // Arrives holding 'blasting' at Rookie (level 1).
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
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

    const { employee: rookie } = hireEmployee(state.employees, 'blaster', rng); // stays level 1
    const { employee: master } = hireEmployee(state.employees, 'blaster', rng);
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

  it('a hungry employee is seeded a longer duration than a well-fed one — combined modifiers apply', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee: fed } = hireEmployee(state.employees, 'blaster', rng);
    const { employee: hungry } = hireEmployee(state.employees, 'blaster', rng);
    hungry.hunger = 20; // below NEED_THRESHOLDS.hunger.low (30) → productivity penalty

    state.pendingActions.push(makeSkillAction({ id: 1, targetEmployeeId: fed.id }));
    state.pendingActions.push(makeSkillAction({ id: 2, targetEmployeeId: hungry.id }));
    tickEmployees(state);
    resolveArrival(state);

    expect(fed.taskTicksRemaining).not.toBeNull();
    expect(hungry.taskTicksRemaining).not.toBeNull();
    expect(hungry.taskTicksRemaining!).toBeGreaterThan(fed.taskTicksRemaining!);
  });

  it('rest actions remain seeded through restTicksRemaining, never taskTicksRemaining (regression)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);

    state.pendingActions.push({
      id: 1, type: 'rest', requiredSkill: null, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { needKey: 'hunger', restDuration: 5 },
      targetEmployeeId: employee.id,
      status: 'queued', holderId: null,
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
    expect(vehicle.reservedForActionId).toBe(action.id);
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
   * console tick pipeline is expected to: continuity-promote the vehicle to a
   * follow-up hole if one is available, else release it, then move the
   * completed hole from plannedDrillHoles into drillHoles via
   * landDrilledHole. Returns the ids of holes that landed this tick, in
   * completion order.
   */
  function runFullTickAndLandDrilledHoles(state: GameState): string[] {
    tickEmployees(state);
    tickEmployeeMovement(state);
    tickArrivalGate(state);

    const landed: string[] = [];
    for (const emp of state.employees.employees) {
      if (!emp.alive) continue;
      const progress = tickTaskProgress(state, emp);
      if (!progress?.completed || progress.actionId === undefined) continue;

      const completingAction = state.pendingActions.find(a => a.id === progress.actionId);
      const holeId = completingAction?.payload['holeId'] as string | undefined;

      if (completingAction && completingAction.requiredVehicleRole !== null) {
        const continued = tryContinueVehicleGatedAction(state, emp, completingAction);
        if (!continued) releaseVehicleOnCompletion(state, emp, progress.actionId);
      }
      completePendingAction(state, progress.actionId);

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
    tickEmployeeMovement(state);
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
      tickEmployeeMovement(state);
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
    assignSkill(state.employees, employee.id, 'driving.truck', 1);
    purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);

    const actionId = queueDigRampSegmentAction(state, 10, 0);

    const result = tickEmployees(state);

    expect(employee.activeActionId).toBeNull();
    expect(state.pendingActions.find(a => a.id === actionId)!.status).toBe('queued');
    expect(result.claimed).not.toContain(actionId);
  });
});

describe('isRampSegmentClaimable (#555)', () => {
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

  it('segment index N > 0 is NOT claimable while segment N - 1 is not yet done', () => {
    const state = createGame({ seed: 1 });
    const plannedRamp: PlannedRamp = {
      id: 1,
      def: { originX: 0, originZ: 0, direction: 'south', length: 3, targetDepth: 6 },
      footprint: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      segments: [
        makeTracker(0, 10, false), // segment 0 not yet done
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
