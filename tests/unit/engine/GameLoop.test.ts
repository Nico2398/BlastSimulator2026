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
  tickVehicle,
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
} from '../../../src/core/engine/GameLoop.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { hireEmployee, assignSkill, checkCollapse } from '../../../src/core/entities/Employee.js';
import type { NeedKey } from '../../../src/core/entities/Employee.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import type { EventContext } from '../../../src/core/events/EventPool.js';
import type { FiredEvent } from '../../../src/core/events/EventSystem.js';
import type { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { clearEvents, registerEvents } from '../../../src/core/events/EventPool.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import {
  NEED_REST_DURATIONS,
  NEED_REST_BUILDING_TYPES,
  NEED_REST_SEARCH_RADIUS,
  NEED_WARNING_THRESHOLDS,
  NEED_REST_COSTS,
  WORK_DURATION_TICKS,
  SHIFT_SLEEP_DURATION_TICKS,
} from '../../../src/core/config/balance.js';

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

const VEHICLE_TICK_SEED = 42;

describe('tickVehicle (Task 2.7)', () => {
  it('advances a moving vehicle toward its target cell', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 2;
    vehicle.targetZ = 0;

    tickVehicle(state, vehicle);
    expect(vehicle.x).toBe(1);
    expect(vehicle.z).toBe(0);
    expect(vehicle.state).toBe('moving');
    expect(vehicle.task).toBe('moving');

    tickVehicle(state, vehicle);
    expect(vehicle.x).toBe(2);
    expect(vehicle.z).toBe(0);
    expect(vehicle.state).toBe('idle');
    expect(vehicle.task).toBe('idle');
  });

  it('puts one vehicle into waiting when two vehicles converge on the same target cell', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: left } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { vehicle: right } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 0);

    left.task = 'moving';
    left.state = 'moving';
    left.targetX = 1;
    left.targetZ = 0;

    right.task = 'moving';
    right.state = 'moving';
    right.targetX = 1;
    right.targetZ = 0;

    tickVehicle(state, left);
    tickVehicle(state, right);

    const waitingVehicles = [left, right].filter(v => v.state === 'waiting');
    expect(waitingVehicles).toHaveLength(1);
    const movingVehicles = [left, right].filter(v => v.state !== 'waiting');
    expect(movingVehicles).toHaveLength(1);
    expect(movingVehicles[0]!.x).toBe(1);
    expect(movingVehicles[0]!.z).toBe(0);
  });

  it('resumes waiting vehicle movement when the blocked cell becomes free', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { vehicle: waiting } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 0);

    blocker.task = 'moving';
    blocker.state = 'moving';
    blocker.targetX = 1;
    blocker.targetZ = 0;

    waiting.task = 'moving';
    waiting.state = 'moving';
    waiting.targetX = 1;
    waiting.targetZ = 0;

    tickVehicle(state, blocker);
    tickVehicle(state, waiting);
    expect(waiting.state).toBe('waiting');

    blocker.task = 'moving';
    blocker.state = 'moving';
    blocker.targetX = 0;
    blocker.targetZ = 0;
    tickVehicle(state, blocker);

    tickVehicle(state, waiting);
    expect(waiting.x).toBe(1);
    expect(waiting.z).toBe(0);
    expect(waiting.state).toBe('idle');
  });
});

// ── Task 2.8: Vehicle.waitingTicks tracking ──────────────────────────────────

describe('tickVehicle — waitingTicks (Task 2.8)', () => {
  it('increments waitingTicks by 1 on each tick the vehicle remains in waiting state', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { vehicle: waiting } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);

    // Both vehicles head for the same cell (1, 0)
    blocker.task = 'moving'; blocker.state = 'moving';
    blocker.targetX = 1;     blocker.targetZ = 0;

    waiting.task = 'moving'; waiting.state = 'moving';
    waiting.targetX = 1;     waiting.targetZ = 0;

    // Tick 1 — blocker arrives at (1,0); debris_hauler is blocked → waiting
    tickVehicle(state, blocker);
    tickVehicle(state, waiting);
    expect(waiting.state).toBe('waiting');
    expect(waiting.waitingTicks).toBe(1);

    // Tick 2 — blocker is idle at (1,0), still blocking; waitingTicks → 2
    tickVehicle(state, blocker); // no-op (task = 'idle')
    tickVehicle(state, waiting);
    expect(waiting.waitingTicks).toBe(2);

    // Tick 3 — same situation; waitingTicks → 3
    tickVehicle(state, blocker);
    tickVehicle(state, waiting);
    expect(waiting.waitingTicks).toBe(3);
  });

  it('resets waitingTicks to 0 when the vehicle transitions from waiting to moving', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { vehicle: waiting } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);

    blocker.task = 'moving'; blocker.state = 'moving';
    blocker.targetX = 1;     blocker.targetZ = 0;

    waiting.task = 'moving'; waiting.state = 'moving';
    waiting.targetX = 1;     waiting.targetZ = 0;

    // Build up waitingTicks
    tickVehicle(state, blocker);
    tickVehicle(state, waiting);
    expect(waiting.state).toBe('waiting');
    expect(waiting.waitingTicks).toBe(1);

    tickVehicle(state, blocker); // no-op
    tickVehicle(state, waiting);
    expect(waiting.waitingTicks).toBe(2);

    // Teleport the blocker away so cell (1,0) is free
    blocker.x = 99;
    blocker.z = 99;

    // Next tickVehicle — waiting vehicle finally moves; waitingTicks must reset
    tickVehicle(state, waiting);
    expect(waiting.state).not.toBe('waiting');
    expect(waiting.waitingTicks).toBe(0);
  });

  it('resets waitingTicks to 0 when the vehicle reaches its target and becomes idle', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: v } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);

    // Manually prime waitingTicks to a non-zero value (simulates prior waiting)
    v.waitingTicks = 5;

    // Vehicle moves straight to its target — no blocking
    v.task = 'moving'; v.state = 'moving';
    v.targetX = 1;     v.targetZ = 0;

    tickVehicle(state, v);

    // Vehicle reached target → idle; waitingTicks must be 0
    expect(v.state).toBe('idle');
    expect(v.waitingTicks).toBe(0);
  });
});

// ── Task 3.6: tickEmployees — claim logic ────────────────────────────────────

describe('tickEmployees — claim logic (Task 3.6)', () => {
  const SEED = 42;

  /** Build a minimal PendingAction for tests. */
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

    // Action should have been claimed — removed from pendingActions
    expect(state.pendingActions).toHaveLength(0);
    // Employee should hold the action's id
    expect((employee as any).activeActionId).toBe(action.id);
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

    // Both actions must have been claimed
    expect(state.pendingActions).toHaveLength(0);
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

    // Only one action can be assigned to the single employee per tick
    expect(state.pendingActions).toHaveLength(1);
    expect((employee as any).activeActionId).not.toBeNull();
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
    const rng = new Random(SEED);

    const ORIGINAL_ACTION_ID = 100;
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = ORIGINAL_ACTION_ID;
    employee.ticksWorked = WORK_DURATION_TICKS - 1; // 5 — next tick triggers shift rest

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    expect(result.shiftRested).toContain(employee.id);
    expect(employee.restTicksRemaining).toBe(SHIFT_SLEEP_DURATION_TICKS);
    // Employee should be claimed by a rest action (activeActionId changed)
    expect(employee.activeActionId).not.toBe(ORIGINAL_ACTION_ID);
    expect(employee.activeActionId).not.toBeNull();
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('restTicksRemaining decrements each tick while resting', () => {
    const state = createGame({ seed: SEED });
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

    // emp1's rest timer starts
    expect(emp1.restTicksRemaining).toBe(SHIFT_SLEEP_DURATION_TICKS);

    // emp2 continues working
    expect(emp2.ticksWorked).toBe(3);
    expect(emp2.restTicksRemaining).toBeNull();
  });

  // ── Test 15 ─────────────────────────────────────────────────────────────────
  it('emits employee:shift_change via emitter when shift rest starts', () => {
    const state = createGame({ seed: SEED });
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
