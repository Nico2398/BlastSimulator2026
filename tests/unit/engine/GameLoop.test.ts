// BlastSimulator2026 — Tests for GameLoop time acceleration

import { describe, it, expect, beforeEach } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  processFrame,
  setSpeed,
  pause,
  resume,
  isValidSpeed,
  BASE_TICK_MS,
  tickEmployees,
  // tickNeedRestoration is imported here for Task 3.11 tests.
  // It does not exist yet — tests will fail (Red phase) until the implementation lands.
  tickNeedRestoration,
  // ── 7.6: tickCollapse ──
  tickCollapse,
  type CollapseResult,
  // ── 7.7: autoInsertNeedTasks ──
  autoInsertNeedTasks,
  type NeedInsertionResult,
  // ── 7.8: deductRestCost ──
  deductRestCost,
  // ── 7.9: shift cycle ──
  processShiftCycle,
  type ShiftCycleResult,
  // ── tickGeneralRestCompletion ──
  tickGeneralRestCompletion,
  type GeneralRestCompletionResult,
  // ── tickTaskProgress: task-duration countdown + tick-driven XP (issue #406) ──
  // Stub as of this branch — the tests below are the Red-phase spec for it.
  tickTaskProgress,
  // ── ArrivalGate (#437): claim only queues pendingRestDuration/pendingTaskDuration —
  // the timer itself starts once the employee has arrived at targetX/targetZ.
  tickArrivalGate,
} from '../../../src/core/engine/GameLoop.js';
import { tickEmployeeMovement } from '../../../src/core/engine/EntityMovementTick.js';
import { completePendingAction } from '../../../src/core/engine/TaskDispatch.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import {
  hireEmployee, assignSkill, checkCollapse, getNeedMultiplier, computeTaskDuration,
} from '../../../src/core/entities/Employee.js';
import type { NeedKey } from '../../../src/core/entities/Employee.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import type { EventContext } from '../../../src/core/events/EventPool.js';
import type { FiredEvent } from '../../../src/core/events/EventSystem.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { clearEvents, registerEvents } from '../../../src/core/events/EventPool.js';
import { getLivingQuartersWellbeingMultiplier } from '../../../src/core/entities/BuildingWellbeing.js';
import {
  NEED_REST_DURATIONS,
  NEED_REST_BUILDING_TYPES,
  NEED_WARNING_THRESHOLDS,
  NEED_REST_COSTS,
  WORK_DURATION_TICKS,
  SHIFT_SLEEP_DURATION_TICKS,
  MAX_NEED_GAUGE,
  NEED_REST_NO_BUILDING_CAP,
  NEED_REST_NO_BUILDING_DURATION_MULTIPLIER,
  BASE_TASK_DURATION_TICKS,
  XP_THRESHOLDS,
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

function buildContext(state: GameState): EventContext {
  return {
    scores: state.scores,
    employeeCount: state.employees.employees.length,
    deathCount: state.damage.deathCount,
    corruptionLevel: state.corruption.level,
    hasBuilding: () => false,
    hasDrillPlan: false,
    tickCount: state.tickCount,
    lawsuitCount: 0,
    activeContractCount: 0,
    weatherId: 'clear',
  };
}

describe('GameLoop', () => {
  let state: GameState;
  let rng: Random;

  beforeEach(() => {
    clearEvents();
    state = createGame({ seed: 42 });
    rng = new Random(42);
  });

  it('processes 1 tick at 1x speed', () => {
    state.timeScale = 1;
    const result = processFrame(state, buildContext, rng);
    expect(result.ticksProcessed).toBe(1);
    expect(state.tickCount).toBe(1);
    expect(state.time).toBe(BASE_TICK_MS);
  });

  it('processes 4 ticks at 4x speed', () => {
    state.timeScale = 4;
    const result = processFrame(state, buildContext, rng);
    expect(result.ticksProcessed).toBe(4);
    expect(state.tickCount).toBe(4);
    expect(state.time).toBe(4 * BASE_TICK_MS);
  });

  it('processes 8 ticks at 8x speed', () => {
    state.timeScale = 8;
    const result = processFrame(state, buildContext, rng);
    expect(result.ticksProcessed).toBe(8);
    expect(state.tickCount).toBe(8);
  });

  it('does nothing when paused', () => {
    state.isPaused = true;
    const result = processFrame(state, buildContext, rng);
    expect(result.ticksProcessed).toBe(0);
    expect(state.tickCount).toBe(0);
  });

  it('auto-pauses when event fires (requires decision)', () => {
    // Register a simple event that always fires
    setupEvents();
    // Bypass cooldown gate so the event can fire on the first tick
    state.events.lastEventTick = -200;
    state.events.actionCountSinceEvent = 10;
    // Set timers to fire immediately by advancing close to trigger
    for (const timer of state.events.timers) {
      timer.remaining = 1;
    }
    state.timeScale = 4;
    const result = processFrame(state, buildContext, rng);
    // Should auto-pause after the event fires
    expect(state.isPaused).toBe(true);
    if (result.firedEvents.length > 0) {
      expect(result.autoPaused).toBe(true);
      expect(result.autoPauseReason).toContain('Event requires decision');
      // Should NOT have processed all 4 ticks (stopped at event)
      expect(result.ticksProcessed).toBeLessThanOrEqual(4);
    }
  });

  it('costs accumulate faster at 4x speed', () => {
    state.timeScale = 1;
    processFrame(state, buildContext, rng);
    const tick1 = state.tickCount;

    state.timeScale = 4;
    processFrame(state, buildContext, rng);
    const tick2 = state.tickCount;

    // 1 tick at 1x, then 4 ticks at 4x = 5 total
    expect(tick2 - tick1).toBe(4);
  });

  it('setSpeed validates input', () => {
    expect(setSpeed(state, 4)).toBe(true);
    expect(state.timeScale).toBe(4);

    expect(setSpeed(state, 3)).toBe(false);
    expect(state.timeScale).toBe(4); // unchanged
  });

  it('pause and resume work', () => {
    expect(state.isPaused).toBe(false);
    pause(state);
    expect(state.isPaused).toBe(true);
    resume(state);
    expect(state.isPaused).toBe(false);
  });

  it('isValidSpeed identifies correct values', () => {
    expect(isValidSpeed(1)).toBe(true);
    expect(isValidSpeed(2)).toBe(true);
    expect(isValidSpeed(4)).toBe(true);
    expect(isValidSpeed(8)).toBe(true);
    expect(isValidSpeed(3)).toBe(false);
    expect(isValidSpeed(0)).toBe(false);
    expect(isValidSpeed(16)).toBe(false);
  });
});

// ── Task 3.6: tickEmployees — claim logic ────────────────────────────────────

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

// ── Issue #549: cost-based per-employee action selection & task queues ─────
//
// tickEmployees's claim logic (Task 3.6, above) is first-come-first-served —
// array/insertion order, not cost. #549 replaces that with
// selectBestActionForEmployee (ActionSelection.ts): each idle qualified
// employee picks its own cheapest reachable candidate (travel + work),
// unreachable candidates are skipped this tick (not stalled — retried once
// the grid changes), an assigned action is never reclaimed by anyone else,
// and employees hold up to MAX_EMPLOYEE_TASK_QUEUE_DEPTH queued follow-up
// actions (Employee.taskQueue), executed in cheapest-next order recomputed
// from wherever the employee actually ends up — not fixed at enqueue time.
// All tests below are Red until tickEmployees is rewired onto
// ActionSelection.ts.

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
    // Near emp2, slow — emp2 stays busy long after emp1 frees.
    const nearEmp2 = makeAction({ id: 2, targetX: 28, targetZ: 0, requiredSkill: 'blasting', payload: { durationTicks: 40 } });
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
    // leftover next, long before emp2 frees from its 40-tick task.
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

// ── Issue #406: task duration seeding + tick-driven XP pipeline ─────────────
//
// tickEmployees claims a skill-required PendingAction and must seed
// taskTicksRemaining from BASE_TASK_DURATION_TICKS via computeTaskDuration()
// (proficiency × need × living-quarters × event multipliers), mirroring the
// 'rest' seeding block already present for restTicksRemaining. tickTaskProgress
// then counts it down to 0 tick by tick, granting XP through the existing
// gainXp() pipeline each tick, and frees the employee on completion.
//
// No living_quarters is built in this section, so the Living Quarters
// well-being multiplier stays at its 'absent' value (see
// LIVING_QUARTERS_WELLBEING_MULTIPLIERS.absent) and the Bunkhouse Tier 2+
// shift cycle never engages — task duration stays deterministic and
// unaffected by forced shift rest.

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

describe('tickTaskProgress — per-tick countdown, incremental XP, and completion (Ch.3 skill progression, issue #406)', () => {
  const SEED = 42;

  /**
   * Dispatch a 'blasting'-required task to `employeeId` and let tickEmployees
   * claim + seed it. targetX/Z (0,0) matches every hireEmployee call in this
   * describe block (defaults to (0,0)), so resolveArrival's single movement
   * pass resolves arrival immediately and taskTicksRemaining is seeded (#437).
   */
  function dispatchAndClaim(state: GameState, employeeId: number, actionId: number): void {
    state.pendingActions.push({
      id: actionId, type: 'general_work', requiredSkill: 'blasting', requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: employeeId,
      status: 'queued', holderId: null,
    });
    tickEmployees(state);
    resolveArrival(state);
  }

  it('decrements taskTicksRemaining by exactly 1 per call', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    dispatchAndClaim(state, employee.id, 1);

    const before = employee.taskTicksRemaining!;
    expect(before).toBeGreaterThan(0);

    tickTaskProgress(state, employee);

    expect(employee.taskTicksRemaining).toBe(before - 1);
  });

  it('grants XP incrementally each tick — not deferred to a single lump sum at completion', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng); // 'blasting' level 1, xp 0
    dispatchAndClaim(state, employee.id, 1);

    const qual = () => employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual().xp).toBe(0);

    tickTaskProgress(state, employee);
    const xpAfterOne = qual().xp;
    expect(xpAfterOne).toBeGreaterThan(0);

    tickTaskProgress(state, employee);
    const xpAfterTwo = qual().xp;
    expect(xpAfterTwo).toBeGreaterThan(xpAfterOne);
    // Constant per-tick step while the level has not changed — proves XP is
    // granted every tick of active work, not saved up for a single award.
    expect(xpAfterTwo - xpAfterOne).toBe(xpAfterOne);

    tickTaskProgress(state, employee);
    const xpAfterThree = qual().xp;
    expect(xpAfterThree).toBeGreaterThan(xpAfterTwo);
  });

  it('clears activeActionId and resets taskTicksRemaining to null on completion', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, employee.id, 'blasting', 5); // Master — shortest duration
    dispatchAndClaim(state, employee.id, 1);

    const totalTicks = employee.taskTicksRemaining!;
    expect(totalTicks).toBeGreaterThan(0);

    for (let i = 0; i < totalTicks; i++) {
      tickTaskProgress(state, employee);
    }

    expect(employee.taskTicksRemaining).toBeNull();
    expect(employee.activeActionId).toBeNull();
  });

  it('a freed employee becomes claimable by the next queued action after task completion', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, employee.id, 'blasting', 5);
    dispatchAndClaim(state, employee.id, 1);

    const totalTicks = employee.taskTicksRemaining!;
    for (let i = 0; i < totalTicks; i++) tickTaskProgress(state, employee);
    expect(employee.activeActionId).toBeNull();

    // Queue a second action, open to any qualified idle employee.
    state.pendingActions.push({
      id: 2, type: 'general_work', requiredSkill: 'blasting', requiredVehicleRole: null,
      targetX: 1, targetZ: 1, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'queued', holderId: null,
    });
    const result = tickEmployees(state);

    expect(result.claimed).toContain(2);
    expect(employee.activeActionId).toBe(2);
  });

  it('crossing an XP threshold purely from ticking triggers a level-up (no direct assign_skill/gainXp call)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng); // 'blasting' level 1
    // Test setup positions XP just short of the level-2 threshold — the
    // proficiency level itself is never set directly, only its XP.
    employee.qualifications.find(q => q.category === 'blasting')!.xp = XP_THRESHOLDS[2] - 2;

    dispatchAndClaim(state, employee.id, 1);
    const qual = () => employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual().proficiencyLevel).toBe(1);

    // Rookie grants 1 xp/tick (1 + floor(1 * 0.5)) — two ticks cross the threshold.
    tickTaskProgress(state, employee);
    tickTaskProgress(state, employee);

    expect(qual().proficiencyLevel).toBe(2);
    expect(qual().xp).toBeGreaterThanOrEqual(XP_THRESHOLDS[2]);
  });
});

// ── Task 3.11: tickNeedRestoration ───────────────────────────────────────────
//
// Tests cover the auto-routing of employees whose need gauges (hunger < 35 OR
// fatigue < 25) drop below warning thresholds to the nearest active
// living_quarters building via a `rest` PendingAction.

describe('tickNeedRestoration (Task 3.11)', () => {
  const SEED = 42;

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('routes a hungry employee (hunger < 35) to rest when a living_quarters is active', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    // Hunger 30 is below the NEED_RESTORATION_THRESHOLDS.hunger = 35 threshold.
    employee.hunger  = 30;
    employee.fatigue = 80; // well above the fatigue threshold of 25

    // Place one active living_quarters on the grid.
    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100);

    const result = tickNeedRestoration(state);

    // Employee must be added to the routed list.
    expect(result.routed).toContain(employee.id);

    // Employee must have been assigned an action (no longer idle).
    expect(employee.activeActionId).not.toBeNull();

    // A rest action targeting this employee must exist in pendingActions.
    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('routes a fatigued employee (fatigue < 25) to rest when a living_quarters is active', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    employee.hunger  = 80; // well above the hunger threshold of 35
    // Fatigue 20 is below the NEED_RESTORATION_THRESHOLDS.fatigue = 25 threshold.
    employee.fatigue = 20;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100);

    const result = tickNeedRestoration(state);

    expect(result.routed).toContain(employee.id);
    expect(employee.activeActionId).not.toBeNull();

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('does NOT route an employee whose gauges are comfortably above both thresholds', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    // Both gauges well above their respective thresholds (35 / 25).
    employee.hunger  = 80;
    employee.fatigue = 80;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100);

    const result = tickNeedRestoration(state);
    expect(result.routed).toHaveLength(0);
    expect(employee.activeActionId).toBeNull();
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('does NOT route an already-busy employee even when they are hungry', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    // Employee is critically hungry but already claimed a different action.
    employee.hunger        = 10; // far below hunger threshold of 35
    employee.activeActionId = 99; // already busy

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100);

    const result = tickNeedRestoration(state);

    // Busy employees must be skipped entirely.
    expect(result.routed).toHaveLength(0);
    // The pre-existing activeActionId must remain untouched.
    expect(employee.activeActionId).toBe(99);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('adds employee to noBuilding when need is below threshold but no living_quarters exists', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 20; // below hunger threshold of 35
    // No buildings placed — living_quarters is absent.

    const result = tickNeedRestoration(state);

    // With no available building, the employee cannot be routed.
    expect(result.noBuilding).toContain(employee.id);
    // Employee must NOT be assigned any action.
    expect(employee.activeActionId).toBeNull();
    // Result routed list must be empty.
    expect(result.routed).toHaveLength(0);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('tickEmployees does not reassign an employee who is currently resting', () => {
    // An employee already holding a rest action (activeActionId != null) must be
    // treated as "busy" by tickEmployees — work actions must stay in pendingActions.
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, employee.id, 'blasting', 1);

    // Simulate the employee being mid-rest: their activeActionId is set.
    const REST_ACTION_ID = 500;
    employee.activeActionId = REST_ACTION_ID;

    // A new blast work action is now pending.
    const workAction: PendingAction = {
      id: 600,
      type: 'drill_hole',
      requiredSkill: 'blasting',
      requiredVehicleRole: null,
      targetX: 5,
      targetZ: 5,
      targetY: 0,
      payload: {},
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
    };
    state.pendingActions.push(workAction);

    tickEmployees(state);

    // The work action must remain in pendingActions — the resting employee cannot
    // claim it while their activeActionId is non-null.
    expect(state.pendingActions).toHaveLength(1);
    expect(state.pendingActions[0]!.id).toBe(600);

    // The employee's rest assignment must be undisturbed.
    expect(employee.activeActionId).toBe(REST_ACTION_ID);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('selects the nearest active living_quarters by Euclidean distance', () => {
    // Employee is at (0, 0).
    // Two living_quarters buildings are placed:
    //   • near:  origin (5, 0)  — Euclidean distance from employee ≈ 5
    //   • far:   origin (50, 50) — Euclidean distance from employee ≈ 70.7
    // The routing logic must pick the nearer building.
    //
    // Note: living_quarters tier 1 has a 3×3 footprint, so both buildings
    // fit comfortably within the 100×100 grid without overlapping.
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x       = 0;
    employee.z       = 0;
    employee.hunger  = 20; // below hunger threshold of 35

    // Near building: origin (5, 0)
    const nearResult = placeBuilding(state.buildings, 'living_quarters', 5, 0, 100, 100);
    expect(nearResult.success).toBe(true); // guard: placement must succeed

    // Far building: origin (50, 50)  — 3×3 footprint keeps it within grid
    const farResult = placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100);
    expect(farResult.success).toBe(true); // guard: placement must succeed

    tickNeedRestoration(state);

    // The created rest action must target the nearer building, not the far one.
    const restAction = state.pendingActions.find((a: PendingAction) => a.type === 'rest');
    expect(restAction).toBeDefined();

    // targetX and targetZ must correspond to the near building's location (x=5, z=0),
    // not the far building's location (x=50, z=50).
    expect(restAction!.targetX).toBe(nearResult.building!.x);
    expect(restAction!.targetZ).toBe(nearResult.building!.z);
    expect(restAction!.targetX).not.toBe(farResult.building!.x);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.6 — tickCollapse: interrupt task queue, prepend rest task
//
// Function under test:
//   tickCollapse(state) → CollapseResult
//
// When an employee's need gauge drops below its collapse threshold, a rest
// PendingAction is created targeting the nearest suitable building. If no
// building is within NEED_REST_SEARCH_RADIUS (20), the rest duration is
// doubled and the action targets the employee's current position.
// Already-collapsing, dead, and injured employees are skipped.
// ─────────────────────────────────────────────────────────────────────────────
describe('tickCollapse (7.6)', () => {
  const SEED = 42;

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('collapsed employee gets rest PendingAction created', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 5;
    employee.fatigue = 100;
    employee.breakNeed = 100;
    employee.x = 0;
    employee.z = 0;

    // Place a living_quarters within search radius
    const buildResult = placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);
    expect(buildResult.success).toBe(true);

    const result = tickCollapse(state);

    // Result must report this employee as collapsed
    expect(result.collapsed).toHaveLength(1);
    expect(result.collapsed[0]).toBe(employee.id);

    // A rest PendingAction must have been created for this employee
    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
    // The collapsed need must be 'hunger' (hunger=5 triggered the collapse)
    expect(restAction!.payload.collapsedNeed).toBe('hunger');
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('rest action targets the nearest living_quarters building', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 5;
    employee.fatigue = 100;
    employee.breakNeed = 100;
    employee.x = 0;
    employee.z = 0;

    // Two living_quarters: one near (5,5), one far (20,20)
    const nearResult = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(nearResult.success).toBe(true);
    const farResult = placeBuilding(state.buildings, 'living_quarters', 20, 20, 100, 100);
    expect(farResult.success).toBe(true);

    tickCollapse(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest',
    );
    expect(restAction).toBeDefined();
    // Must target the nearer building
    expect(restAction!.targetX).toBe(nearResult.building!.x);
    expect(restAction!.targetZ).toBe(nearResult.building!.z);
    expect(restAction!.targetX).not.toBe(farResult.building!.x);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('no building within 20 cells → restDuration doubled in payload', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 5;
    employee.fatigue = 100;
    employee.breakNeed = 100;
    employee.x = 0;
    employee.z = 0;

    // Building at (50,50) is > 20 cells from (0,0)
    placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100);

    tickCollapse(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest',
    );
    expect(restAction).toBeDefined();
    // restDuration must be doubled (base 2 × 2 = 4 for hunger)
    expect(restAction!.payload.restDuration).toBe(NEED_REST_DURATIONS.hunger * 2);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('no building at all → rest duration doubled, target is employee position', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 5;
    employee.fatigue = 100;
    employee.breakNeed = 100;
    employee.x = 7;
    employee.z = 13;

    // No living_quarters placed anywhere

    tickCollapse(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest',
    );
    expect(restAction).toBeDefined();
    // Target must be the employee's current position
    expect(restAction!.targetX).toBe(7);
    expect(restAction!.targetZ).toBe(13);
    // restDuration must be doubled
    expect(restAction!.payload.restDuration).toBe(NEED_REST_DURATIONS.hunger * 2);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('all gauges above thresholds → no action created', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 50;
    employee.fatigue = 50;
    employee.breakNeed = 50;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('already collapsing → not re-processed', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.collapsing = true;
    employee.hunger = 5;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('dead employee → skipped', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.alive = false;
    employee.hunger = 5;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toHaveLength(0);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('injured employee → skipped', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.injured = true;
    employee.hunger = 5;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toHaveLength(0);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('collapsed result contains employee IDs', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 5;
    employee.fatigue = 100;
    employee.breakNeed = 100;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toEqual([employee.id]);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('fatigue-triggered collapse produces correct collapsedNeed and restDuration', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 100;    // Above hunger threshold (10)
    employee.fatigue = 3;     // Below fatigue threshold (5)
    employee.breakNeed = 100;
    employee.x = 0;
    employee.z = 0;

    // Place a living_quarters within search radius
    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    // Result must report this employee as collapsed
    expect(result.collapsed).toHaveLength(1);
    expect(result.collapsed[0]).toBe(employee.id);

    // The rest action must have collapsedNeed: 'fatigue'
    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
    expect(restAction!.payload.collapsedNeed).toBe('fatigue');
    expect(restAction!.payload.restDuration).toBe(NEED_REST_DURATIONS.fatigue);
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it('adds employee_collapsed to firedEvents when employee collapses', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 5;
    employee.fatigue = 100;
    employee.breakNeed = 100;
    employee.x = 0;
    employee.z = 0;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const firedEvents: FiredEvent[] = [];
    tickCollapse(state, firedEvents);

    expect(firedEvents).toHaveLength(1);
    expect(firedEvents[0]!.eventId).toBe('employee_collapsed');
    expect(firedEvents[0]!.firedAtTick).toBe(state.tickCount);
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────────
  it('emits employee:collapsed via emitter when employee collapses', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 5;
    employee.fatigue = 100;
    employee.breakNeed = 100;
    employee.x = 0;
    employee.z = 0;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const events: string[] = [];
    const mockEmitter = { emit: (event: string) => { events.push(event); } } as unknown as EventEmitter;
    const firedEvents: FiredEvent[] = [];

    tickCollapse(state, firedEvents, mockEmitter);

    expect(events).toContain('employee:collapsed');
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────────
  it('does not emit employee_collapsed when employee is not collapsing', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 50;
    employee.fatigue = 50;
    employee.breakNeed = 50;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const firedEvents: FiredEvent[] = [];
    tickCollapse(state, firedEvents);

    expect(firedEvents).toHaveLength(0);
  });

  // ── Test 14 ─────────────────────────────────────────────────────────────────
  it('emits one employee_collapsed per collapsed employee', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee: emp1 } = hireEmployee(state.employees, 'driller', rng);
    emp1.hunger = 5;
    emp1.fatigue = 100;
    emp1.breakNeed = 100;
    emp1.x = 0;
    emp1.z = 0;

    const { employee: emp2 } = hireEmployee(state.employees, 'blaster', rng);
    emp2.hunger = 5;
    emp2.fatigue = 100;
    emp2.breakNeed = 100;
    emp2.x = 0;
    emp2.z = 0;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const firedEvents: FiredEvent[] = [];
    tickCollapse(state, firedEvents);

    expect(firedEvents).toHaveLength(2);
    expect(firedEvents[0]!.eventId).toBe('employee_collapsed');
    expect(firedEvents[1]!.eventId).toBe('employee_collapsed');
  });

  // ── Collapse supersedes a warning-threshold rest queued while the employee was busy ──
  // autoInsertNeedTasks queues a rest for a busy employee without claiming it.
  // If that action survives the collapse, it is claimed the instant the collapse
  // rest ends: a second rest cycle and a second NEED_REST_COSTS charge for one
  // collapse, and two rest entries in the roster panel's task queue.
  it('drops a rest action already queued for the employee it collapses', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 3; // below the collapse threshold

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    // The warning-threshold rest queued earlier, still unclaimed.
    autoInsertNeedTasks(state);
    const queuedBefore = state.pendingActions.filter(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(queuedBefore).toHaveLength(1);

    tickCollapse(state);

    const restActions = state.pendingActions.filter(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restActions).toHaveLength(1);
    expect(restActions[0]!.id).toBe(employee.activeActionId);
    // The rest timer itself does not start until ArrivalGate confirms the
    // employee has walked to the building — restNeedKey stays queued as
    // pendingRestNeedKey until then (#437).
    expect(employee.pendingRestNeedKey).toBe('fatigue');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.7 — autoInsertNeedTasks: proactive rest action insertion
//
// Function under test:
//   autoInsertNeedTasks(state) → NeedInsertionResult
//
// Reads NEED_WARNING_THRESHOLDS (hunger<35, fatigue<25, breakNeed<30) and
// conditionally inserts a rest PendingAction for each employee whose gauge
// is below threshold. Busy employees are also serviced (inserted but not
// claimed). Dead, injured, collapsing, and already-queued employees are
// skipped. Nearest suitable building is targeted.
// ─────────────────────────────────────────────────────────────────────────────
describe('autoInsertNeedTasks (7.7)', () => {
  const SEED = 42;

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('busy employee with hunger < 35 → rest action queued, activeActionId unchanged', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 30;
    employee.fatigue = 80;
    employee.breakNeed = 80;
    employee.activeActionId = 42; // already busy

    const buildResult = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(buildResult.success).toBe(true);

    const result = autoInsertNeedTasks(state);

    // Must report insertion
    expect(result.inserted).toHaveLength(1);
    expect(result.inserted[0]!.employeeId).toBe(employee.id);
    expect(result.inserted[0]!.needKey).toBe('hunger');

    // activeActionId must remain unchanged
    expect(employee.activeActionId).toBe(42);

    // A rest PendingAction must exist for this employee
    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();

    // Skipped must be empty
    expect(result.skipped).toHaveLength(0);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('busy employee with fatigue < 25 → rest action queued', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 80;
    employee.fatigue = 20; // below threshold of 25
    employee.breakNeed = 80;
    employee.activeActionId = 42;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(1);
    expect(result.inserted[0]!.employeeId).toBe(employee.id);
    expect(result.inserted[0]!.needKey).toBe('fatigue');
    expect(employee.activeActionId).toBe(42);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
    expect(result.skipped).toHaveLength(0);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('idle employee with breakNeed < 30 → rest action queued', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 80;
    employee.fatigue = 80;
    employee.breakNeed = 25; // below threshold of 30
    employee.activeActionId = null; // idle

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(1);
    expect(result.inserted[0]!.employeeId).toBe(employee.id);
    expect(result.inserted[0]!.needKey).toBe('breakNeed');

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
    expect(result.skipped).toHaveLength(0);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('all gauges above thresholds → no action created', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 80;
    employee.fatigue = 80;
    employee.breakNeed = 80;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('dead employee → skipped', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.alive = false;
    employee.hunger = 30;
    employee.fatigue = 80;
    employee.breakNeed = 80;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('injured employee → skipped', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.injured = true;
    employee.hunger = 30;
    employee.fatigue = 80;
    employee.breakNeed = 80;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('collapsing employee → skipped', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.collapsing = true;
    employee.hunger = 30;
    employee.fatigue = 80;
    employee.breakNeed = 80;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('employee with rest action already pending → skipped with reason', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 30; // below threshold
    employee.fatigue = 80;
    employee.breakNeed = 80;
    employee.activeActionId = null;

    // Manually push a rest PendingAction targeting this employee
    state.pendingActions.push({
      id: state.nextPendingActionId++,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 0,
      targetZ: 0,
      targetY: 0,
      payload: {},
      targetEmployeeId: employee.id,
      status: 'queued', holderId: null,
    });

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.employeeId).toBe(employee.id);
    expect(result.skipped[0]!.needKey).toBe('hunger');
    expect(result.skipped[0]!.reason).toBe('rest_action_already_queued');

    // Only the pre-existing action remains
    expect(state.pendingActions).toHaveLength(1);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('multiple gauges below warning → one rest action with all triggered needs', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 30;    // below 35
    employee.fatigue = 20;   // below 25
    employee.breakNeed = 25; // below 30
    employee.activeActionId = null;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    // All three need keys must appear in the inserted result
    const needKeys = result.inserted.map(r => r.needKey);
    expect(needKeys).toContain('hunger');
    expect(needKeys).toContain('fatigue');
    expect(needKeys).toContain('breakNeed');

    // But only ONE rest action should exist in pendingActions
    const restActions = state.pendingActions.filter(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restActions).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('rest action shape validation', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 30; // below threshold
    employee.fatigue = 80;
    employee.breakNeed = 80;

    const buildResult = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(buildResult.success).toBe(true);

    autoInsertNeedTasks(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
    expect(restAction!.type).toBe('rest');
    expect(restAction!.requiredSkill).toBeNull();
    expect(restAction!.requiredVehicleRole).toBeNull();
    expect(restAction!.targetEmployeeId).toBe(employee.id);
    expect(restAction!.payload.buildingId).toBe(buildResult.building!.id);
    expect(restAction!.payload.restDuration).toBeDefined();
    expect(typeof restAction!.payload.restDuration).toBe('number');
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it('nearest building selected', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 30;
    employee.fatigue = 80;
    employee.breakNeed = 80;

    // Near building: (5, 5)
    const nearResult = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(nearResult.success).toBe(true);

    // Far building: (50, 50)
    const farResult = placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100);
    expect(farResult.success).toBe(true);

    autoInsertNeedTasks(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest',
    );
    expect(restAction).toBeDefined();
    // Must target the near building (5, 5), not the far one (50, 50)
    expect(restAction!.targetX).toBe(nearResult.building!.x);
    expect(restAction!.targetZ).toBe(nearResult.building!.z);
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────────
  it('no building → target is employee position', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 7;
    employee.z = 13;
    employee.hunger = 30; // below threshold
    employee.fatigue = 80;
    employee.breakNeed = 80;

    // No buildings placed

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(1);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
    expect(restAction!.targetX).toBe(7);
    expect(restAction!.targetZ).toBe(13);
    // payload.buildingId must be undefined
    expect(restAction!.payload.buildingId).toBeUndefined();
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────────
  it('boundary: gauge exactly at threshold (e.g. hunger=35) → no action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = NEED_WARNING_THRESHOLDS.hunger; // exactly 35
    employee.fatigue = 80;
    employee.breakNeed = 80;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 14 ─────────────────────────────────────────────────────────────────
  it('insertion and skip results populated correctly for mixed scenario', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    // Employee A: hungry
    const { employee: empA } = hireEmployee(state.employees, 'driller', rng);
    empA.x = 0;
    empA.z = 0;
    empA.hunger = 30;
    empA.fatigue = 80;
    empA.breakNeed = 80;
    empA.activeActionId = null;

    // Employee B: also hungry, but already has a rest action pending
    const { employee: empB } = hireEmployee(state.employees, 'blaster', rng);
    empB.x = 0;
    empB.z = 0;
    empB.hunger = 30;
    empB.fatigue = 80;
    empB.breakNeed = 80;
    empB.activeActionId = null;

    // Pre-insert a rest action for employee B
    state.pendingActions.push({
      id: state.nextPendingActionId++,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 0,
      targetZ: 0,
      targetY: 0,
      payload: {},
      targetEmployeeId: empB.id,
      status: 'queued', holderId: null,
    });

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    // Employee A must be inserted
    expect(result.inserted).toHaveLength(1);
    expect(result.inserted[0]!.employeeId).toBe(empA.id);
    expect(result.inserted[0]!.needKey).toBe('hunger');

    // Employee B must be skipped with reason
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.employeeId).toBe(empB.id);
    expect(result.skipped[0]!.needKey).toBe('hunger');
    expect(result.skipped[0]!.reason).toBe('rest_action_already_queued');
  });

  // ── Test 15 ─────────────────────────────────────────────────────────────────
  it('nextPendingActionId incremented after insertion', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 30;
    employee.fatigue = 80;
    employee.breakNeed = 80;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const beforeId = state.nextPendingActionId;

    autoInsertNeedTasks(state);

    // nextPendingActionId must have been incremented (one rest action inserted)
    expect(state.nextPendingActionId).toBe(beforeId + 1);
  });

  // ── Test 16 ─────────────────────────────────────────────────────────────────
  it('adds need_warning to firedEvents when rest action already queued', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 30; // below threshold
    employee.fatigue = 80;
    employee.breakNeed = 80;
    employee.activeActionId = null;

    // Pre-insert a rest action for this employee
    state.pendingActions.push({
      id: state.nextPendingActionId++,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 0,
      targetZ: 0,
      targetY: 0,
      payload: {},
      targetEmployeeId: employee.id,
      status: 'queued', holderId: null,
    });

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const firedEvents: FiredEvent[] = [];
    autoInsertNeedTasks(state, firedEvents);

    expect(firedEvents).toHaveLength(1);
    expect(firedEvents[0]!.eventId).toBe('need_warning');
    expect(firedEvents[0]!.firedAtTick).toBe(state.tickCount);
  });

  // ── Test 17 ─────────────────────────────────────────────────────────────────
  it('emits employee:need_warning via emitter when insertion skipped', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 30;
    employee.fatigue = 80;
    employee.breakNeed = 80;
    employee.activeActionId = null;

    // Pre-insert a rest action for this employee
    state.pendingActions.push({
      id: state.nextPendingActionId++,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 0,
      targetZ: 0,
      targetY: 0,
      payload: {},
      targetEmployeeId: employee.id,
      status: 'queued', holderId: null,
    });

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const events: string[] = [];
    const mockEmitter = { emit: (event: string) => { events.push(event); } } as unknown as EventEmitter;
    const firedEvents: FiredEvent[] = [];

    autoInsertNeedTasks(state, firedEvents, mockEmitter);

    expect(events).toContain('employee:need_warning');
  });

  // ── Test 18 ─────────────────────────────────────────────────────────────────
  it('does not emit need_warning when rest action is inserted', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 30;
    employee.fatigue = 80;
    employee.breakNeed = 80;
    employee.activeActionId = null;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const firedEvents: FiredEvent[] = [];
    autoInsertNeedTasks(state, firedEvents);

    expect(firedEvents).toHaveLength(0);
  });

  // ── Test 19 ─────────────────────────────────────────────────────────────────
  it('does not emit need_warning when gauges are above thresholds', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 80;
    employee.fatigue = 80;
    employee.breakNeed = 80;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const firedEvents: FiredEvent[] = [];
    autoInsertNeedTasks(state, firedEvents);

    expect(firedEvents).toHaveLength(0);
  });

  // ── Test 12b: no building to rest at → rest takes the no-building multiplier ─
  it('doubles the queued rest duration when no building services the need', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 30; // below the warning threshold
    employee.fatigue = 80;
    employee.breakNeed = 80;
    // No living_quarters placed — the employee will rest where they stand.

    autoInsertNeedTasks(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
    expect(restAction!.payload['restDuration']).toBe(
      NEED_REST_DURATIONS.hunger * NEED_REST_NO_BUILDING_DURATION_MULTIPLIER,
    );
    expect(restAction!.payload['buildingId']).toBeUndefined();
  });

  // ── Test 12c: a building in range keeps the base duration ───────────────────
  it('keeps the base rest duration when a building services the need', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 30;
    employee.fatigue = 80;
    employee.breakNeed = 80;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    autoInsertNeedTasks(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction!.payload['restDuration']).toBe(NEED_REST_DURATIONS.hunger);
  });

  // ── Test 13: employee already mid-rest → no second rest queued ──────────────
  // A rest claimed through tickEmployees is consumed from pendingActions, so
  // hasRestAction cannot see it. The gauge only recovers when the rest
  // completes, so without a restTicksRemaining check this inserts a duplicate
  // rest that is claimed the instant the first ends — a wasted rest cycle and a
  // second NEED_REST_COSTS charge per dip below the warning threshold.
  it('does not queue a second rest for an employee already resting', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.hunger = 30; // still below the warning threshold — rest not finished yet
    employee.fatigue = 80;
    employee.breakNeed = 80;
    employee.activeActionId = 7;      // claimed the rest action
    employee.restTicksRemaining = 2;  // ...and is mid-rest
    employee.restNeedKey = 'hunger';
    // The claimed action is gone from pendingActions, as tickEmployees leaves it.

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(state.pendingActions.filter((a: PendingAction) => a.type === 'rest')).toHaveLength(0);
  });
});

// ─── 7.8: deductRestCost ──────────────────────────────────────────────────────

const DEDUCT_SEED = 42;

describe('deductRestCost', () => {
  // ── Test 1: Positive: hunger visit deducts NEED_REST_COSTS.hunger from cash ──
  it('deducts NEED_REST_COSTS.hunger from cash for hunger', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    const deducted = deductRestCost(state, 'hunger');

    expect(state.cash).toBe(4950);
    expect(deducted).toBe(NEED_REST_COSTS.hunger);
  });

  // ── Test 2: Positive: breakNeed visit deducts NEED_REST_COSTS.breakNeed from cash ──
  it('deducts NEED_REST_COSTS.breakNeed from cash for breakNeed', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    const deducted = deductRestCost(state, 'breakNeed');

    expect(state.cash).toBe(4980);
    expect(deducted).toBe(NEED_REST_COSTS.breakNeed);
  });

  // ── Test 3: Boundary: fatigue visit deducts 0 from cash ──
  it('deducts 0 from cash for fatigue (no cost)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    const deducted = deductRestCost(state, 'fatigue');

    expect(state.cash).toBe(5000);
    expect(deducted).toBe(0);
  });

  // ── Test 4: Boundary: cash never goes below 0 ──
  it('does not let cash go below 0', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 10;

    const deducted = deductRestCost(state, 'hunger');

    expect(state.cash).toBe(0);
    expect(deducted).toBe(NEED_REST_COSTS.hunger);
  });

  // ── Test 5: Edge: multiple visits accumulate correctly ──
  it('accumulates costs correctly across multiple visits', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 500;

    const deducted1 = deductRestCost(state, 'hunger');
    const deducted2 = deductRestCost(state, 'hunger');
    const deducted3 = deductRestCost(state, 'breakNeed');

    const expectedCash = 500 - 2 * NEED_REST_COSTS.hunger - NEED_REST_COSTS.breakNeed;
    expect(state.cash).toBe(expectedCash);
    expect(deducted1).toBe(NEED_REST_COSTS.hunger);
    expect(deducted2).toBe(NEED_REST_COSTS.hunger);
    expect(deducted3).toBe(NEED_REST_COSTS.breakNeed);
  });

  // ── Test 6: Edge: cash at exactly 0 is unchanged ──
  it('leaves cash at 0 when it is already 0', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 0;

    const deducted = deductRestCost(state, 'hunger');

    expect(state.cash).toBe(0);
    expect(deducted).toBe(NEED_REST_COSTS.hunger);
  });

  // ── Test 6b: Edge: cash already negative is left untouched, not reset to 0 ──
  it('does not reset already-negative cash back up to 0 (a prior bankruptcy-territory balance is not erased)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = -48870;

    const deducted = deductRestCost(state, 'hunger');

    expect(state.cash).toBe(-48870);
    expect(deducted).toBe(NEED_REST_COSTS.hunger);
    expect(state.finances.transactions.find(t => t.category === 'needs')).toBeUndefined();
  });

  // ── Test 7: Positive: records a 'needs'-category expense in state.finances ──
  it('records a needs-category expense transaction in state.finances', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    deductRestCost(state, 'hunger');

    const entry = state.finances.transactions.find(t => t.category === 'needs');
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('expense');
    expect(entry!.amount).toBe(NEED_REST_COSTS.hunger);
    expect(entry!.description).toBe('Rest: hunger');
  });

  // ── Test 8: Boundary: fatigue (0 cost) records no expense (addExpense no-ops on amount <= 0) ──
  it('records no finance transaction for fatigue (zero-cost visit)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    deductRestCost(state, 'fatigue');

    expect(state.finances.transactions.find(t => t.category === 'needs')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.9 — processShiftCycle: Bunkhouse Tier 2+ shift scheduling
//
// Function under test:
//   processShiftCycle(state, firedEvents) → ShiftCycleResult
//
// When a Tier 2+ living_quarters building exists, an 8-tick shift cycle
// activates: employees work WORK_DURATION_TICKS (6) ticks then enter
// SHIFT_SLEEP_DURATION_TICKS (8) ticks of forced rest. The cycle resets
// upon rest completion. Dead/injured employees are skipped.
// ─────────────────────────────────────────────────────────────────────────────
describe('processShiftCycle (7.9)', () => {
  const SEED = 42;

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('inactive when no living_quarters buildings exist', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 10; // working

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    expect(result.active).toBe(false);
    expect(result.restCompleted).toEqual([]);
    expect(result.shiftRested).toEqual([]);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('inactive when only tier 1 living_quarters exists', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    hireEmployee(state.employees, 'driller', rng);
    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    expect(result.active).toBe(false);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('active when tier 2 living_quarters exists', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    hireEmployee(state.employees, 'driller', rng);
    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    expect(result.active).toBe(true);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('active when tier 3 living_quarters exists', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    hireEmployee(state.employees, 'driller', rng);
    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 3);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    expect(result.active).toBe(true);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('ticksWorked increments for working employees', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 10;
    employee.ticksWorked = 0;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const firedEvents: FiredEvent[] = [];
    processShiftCycle(state, firedEvents);

    expect(employee.ticksWorked).toBe(1);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('ticksWorked NOT incremented for idle employees', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = null; // idle
    employee.ticksWorked = 0;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    // Active = true because T2 exists; ticksWorked must remain 0 for idle
    expect(result.active).toBe(true);
    expect(employee.ticksWorked).toBe(0);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('forced rest when ticksWorked reaches WORK_DURATION_TICKS (6)', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    const ORIGINAL_ACTION_ID = 100;
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = ORIGINAL_ACTION_ID;
    employee.ticksWorked = WORK_DURATION_TICKS - 1; // 5 — next tick triggers shift rest

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    expect(result.shiftRested).toContain(employee.id);
    // The rest timer itself does not start until ArrivalGate confirms the
    // employee has walked to the bunkhouse — queued as pendingRestDuration
    // until then (#437).
    expect(employee.pendingRestDuration).toBe(SHIFT_SLEEP_DURATION_TICKS);
    // Employee should be claimed by a rest action (activeActionId changed)
    expect(employee.activeActionId).not.toBe(ORIGINAL_ACTION_ID);
    expect(employee.activeActionId).not.toBeNull();
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('restTicksRemaining decrements each tick while resting', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.restTicksRemaining = 5;
    employee.activeActionId = 200; // busy with rest

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const firedEvents: FiredEvent[] = [];
    processShiftCycle(state, firedEvents);

    expect(employee.restTicksRemaining).toBe(4);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('rest completes after SHIFT_SLEEP_DURATION_TICKS ticks', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.restTicksRemaining = 1; // one more tick → rest completes
    employee.activeActionId = 300;  // in shift rest
    employee.ticksWorked = 5;       // previous shift value
    employee.fatigue = 20;          // fatigued before rest

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    expect(result.restCompleted).toContain(employee.id);
    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.activeActionId).toBeNull(); // freed up after rest
    expect(employee.ticksWorked).toBe(0);       // reset for next shift
    // Fatigue should be restored (increased) upon rest completion
    expect(employee.fatigue).toBeGreaterThan(20);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('employee_shift_change event fired when employee enters shift rest', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 400;
    employee.ticksWorked = WORK_DURATION_TICKS - 1; // 5 — triggers shift rest

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const firedEvents: FiredEvent[] = [];
    processShiftCycle(state, firedEvents);

    expect(firedEvents.length).toBeGreaterThanOrEqual(1);
    expect(firedEvents[0]!.eventId).toBe('employee_shift_change');
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it('dead employees are skipped', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.alive = false;
    employee.activeActionId = 500;
    employee.ticksWorked = 3;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    // Shift logic is active (T2 exists) but dead employee is skipped
    expect(result.active).toBe(true);
    expect(employee.ticksWorked).toBe(3); // unchanged
    expect(employee.restTicksRemaining).toBeNull(); // not put to rest
    expect(result.shiftRested).not.toContain(employee.id);
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────────
  it('injured employees are skipped', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.injured = true;
    employee.activeActionId = 600;
    employee.ticksWorked = 3;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    expect(result.active).toBe(true);
    expect(employee.ticksWorked).toBe(3); // unchanged
    expect(employee.restTicksRemaining).toBeNull(); // not put to rest
    expect(result.shiftRested).not.toContain(employee.id);
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────────
  it('employee with restTicksRemaining does NOT increment ticksWorked', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.restTicksRemaining = 4; // currently resting
    employee.activeActionId = 700;
    employee.ticksWorked = 3; // previous shift work count

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    // Active because T2 building exists
    expect(result.active).toBe(true);
    // ticksWorked must NOT be incremented for a resting employee
    expect(employee.ticksWorked).toBe(3);
    // restTicksRemaining should have decremented (not skipped entirely)
    expect(employee.restTicksRemaining).toBe(3);
  });

  // ── Test 14 ─────────────────────────────────────────────────────────────────
  it('multiple employees cycle independently', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    const { employee: emp1 } = hireEmployee(state.employees, 'driller', rng);
    emp1.activeActionId = 800;
    emp1.ticksWorked = WORK_DURATION_TICKS - 1; // 5 — will trigger shift rest

    const { employee: emp2 } = hireEmployee(state.employees, 'blaster', rng);
    emp2.activeActionId = 801;
    emp2.ticksWorked = 2; // still working

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    // Only emp1 should transition to shift rest
    expect(result.shiftRested).toContain(emp1.id);
    expect(result.shiftRested).not.toContain(emp2.id);

    // emp1's rest timer is queued — it starts once ArrivalGate confirms
    // arrival at the bunkhouse (#437).
    expect(emp1.pendingRestDuration).toBe(SHIFT_SLEEP_DURATION_TICKS);

    // emp2 continues working
    expect(emp2.ticksWorked).toBe(3);
    expect(emp2.restTicksRemaining).toBeNull();
  });

  // ── Test 15 ─────────────────────────────────────────────────────────────────
  it('emits employee:shift_change via emitter when shift rest starts', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 900;
    employee.ticksWorked = WORK_DURATION_TICKS - 1; // triggers shift rest

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const events: string[] = [];
    const mockEmitter = { emit: (event: string) => { events.push(event); } } as unknown as EventEmitter;
    const firedEvents: FiredEvent[] = [];

    processShiftCycle(state, firedEvents, mockEmitter);

    expect(events).toContain('employee:shift_change');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tickGeneralRestCompletion — completion path for hunger/breakNeed/Tier-1
// fatigue rests created by tickCollapse, tickNeedRestoration, and
// autoInsertNeedTasks (see GameLoop.ts). Distinct from processShiftCycle's
// completeRestTick, which owns Tier-2+ Bunkhouse shift-cycle rest instead.
// ─────────────────────────────────────────────────────────────────────────────
describe('tickGeneralRestCompletion', () => {
  const SEED = 42;

  // ── Test 1: Happy path ────────────────────────────────────────────────────
  it('completes rest: replenishes gauge, deducts cost, clears collapsing and rest state', () => {
    const state = createGame({ seed: SEED });
    state.cash = 1000;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 10;
    employee.collapsing = true;
    employee.restTicksRemaining = 1; // one more tick → completes this call
    const actionId = state.nextPendingActionId++;
    employee.activeActionId = actionId;
    employee.restNeedKey = 'hunger';
    state.pendingActions.push({
      id: actionId,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 5,
      targetZ: 5,
      targetY: 0,
      payload: { needKey: 'hunger' },
      targetEmployeeId: employee.id,
      status: 'in_progress',
      holderId: employee.id,
    });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const result: GeneralRestCompletionResult = tickGeneralRestCompletion(state);

    expect(result.completed).toEqual([{ employeeId: employee.id, needKey: 'hunger' }]);
    expect(employee.hunger).toBeGreaterThan(10);
    expect(employee.collapsing).toBe(false);
    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.activeActionId).toBeNull();
    expect(employee.restNeedKey).toBeNull();
    expect(state.cash).toBe(1000 - NEED_REST_COSTS.hunger);
    expect(state.pendingActions.find(a => a.id === actionId)).toBeUndefined();
  });

  // ── Test 2: Boundary — resting with no building tops out at the no-building cap ──
  // A full restore here would make an empty site better than a Tier 1 living_quarters.
  it('caps the gauge at NEED_REST_NO_BUILDING_CAP when no living_quarters exists', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 5;
    employee.restTicksRemaining = 1;
    employee.activeActionId = 42;
    employee.restNeedKey = 'fatigue';
    // No living_quarters building placed at all.

    const result = tickGeneralRestCompletion(state);

    expect(employee.fatigue).toBe(NEED_REST_NO_BUILDING_CAP);
    expect(employee.fatigue).toBeLessThan(MAX_NEED_GAUGE);
    expect(result.completed).toEqual([{ employeeId: employee.id, needKey: 'fatigue' }]);
  });

  // ── Test 2b: Rejection — a gauge above the cap is not pulled down to it ──
  it('leaves a gauge already above the no-building cap untouched', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = NEED_REST_NO_BUILDING_CAP + 15;
    employee.restTicksRemaining = 1;
    employee.activeActionId = 42;
    employee.restNeedKey = 'fatigue';

    tickGeneralRestCompletion(state);

    expect(employee.fatigue).toBe(NEED_REST_NO_BUILDING_CAP + 15);
  });

  // ── Test 3: Not double-processed — owned by completeRestTick (Tier-2+ shift rest) instead ──
  it('does not process an employee owned by the Tier-2+ shift-cycle rest path', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.restTicksRemaining = 1;
    employee.activeActionId = 99;
    employee.restNeedKey = null; // no rest need key → shift-cycle rest, not general rest
    employee.fatigue = 5;

    const result = tickGeneralRestCompletion(state);

    expect(result.completed).toEqual([]);
    expect(employee.restTicksRemaining).toBe(1); // untouched — still owned by processShiftCycle
    expect(employee.fatigue).toBe(5);
  });

  // ── Test 4: Injury does not block rest completion (finding #8) ──
  it('completes rest for an employee who became injured mid-rest', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.injured = true;
    employee.hunger = 10;
    employee.restTicksRemaining = 1;
    const actionId = state.nextPendingActionId++;
    employee.activeActionId = actionId;
    employee.restNeedKey = 'hunger';

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const result = tickGeneralRestCompletion(state);

    expect(result.completed).toEqual([{ employeeId: employee.id, needKey: 'hunger' }]);
    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.activeActionId).toBeNull();
  });

  // ── Test 5: record + ghost both vanish on completion (#547) ────────────────
  // A rest action's own pendingActions record now outlives its claim just like
  // any other action, so completion must clean up both the record and any
  // ghost preview sharing its id — the same completePendingAction contract
  // TaskDispatch.ts exposes for the dispatch/claim path.
  it('removes both the pendingActions record and any ghost preview sharing the completed rest action\'s id', () => {
    const state = createGame({ seed: SEED });
    state.cash = 1000;
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.hunger = 10;
    employee.restTicksRemaining = 1;
    const actionId = state.nextPendingActionId++;
    employee.activeActionId = actionId;
    employee.restNeedKey = 'hunger';
    state.pendingActions.push({
      id: actionId,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 5,
      targetZ: 5,
      targetY: 0,
      payload: { needKey: 'hunger' },
      targetEmployeeId: employee.id,
      status: 'in_progress',
      holderId: employee.id,
    });
    state.ghostPreviews.push({ id: actionId, type: 'rest', targetX: 5, targetZ: 5, targetY: 0, claimed: true });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    tickGeneralRestCompletion(state);

    expect(state.pendingActions.find(a => a.id === actionId)).toBeUndefined();
    expect(state.ghostPreviews.find(g => g.id === actionId)).toBeUndefined();
  });
});
