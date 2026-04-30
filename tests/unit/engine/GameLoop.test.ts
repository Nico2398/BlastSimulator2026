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
} from '../../../src/core/engine/GameLoop.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import type { EventContext } from '../../../src/core/events/EventPool.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { clearEvents, registerEvents } from '../../../src/core/events/EventPool.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';

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
