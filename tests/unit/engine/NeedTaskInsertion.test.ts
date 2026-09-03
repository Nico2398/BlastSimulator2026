// BlastSimulator2026 — Tests for autoInsertNeedTasks: proactive rest-task
// insertion for employees below the need warning threshold (relocated from
// GameLoop.test.ts, #759).
//
// #928: hunger and breakNeed removed — fatigue is the sole gauge every
// insertion decision reads.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { autoInsertNeedTasks } from '../../../src/core/engine/NeedTaskInsertion.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import type { FiredEvent } from '../../../src/core/events/EventSystem.js';
import type { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import {
  NEED_REST_DURATIONS,
  NEED_WARNING_THRESHOLDS,
  NEED_REST_NO_BUILDING_DURATION_MULTIPLIER,
} from '../../../src/core/config/balance.js';

describe('autoInsertNeedTasks (7.7)', () => {
  const SEED = 42;

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('busy employee with fatigue < 25 → rest action queued, activeActionId unchanged', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20; // below threshold of 25
    employee.activeActionId = 42; // already busy

    const buildResult = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(buildResult.success).toBe(true);

    const result = autoInsertNeedTasks(state);

    // Must report insertion
    expect(result.inserted).toHaveLength(1);
    expect(result.inserted[0]!.employeeId).toBe(employee.id);
    expect(result.inserted[0]!.needKey).toBe('fatigue');

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
  it('idle employee with fatigue < 25 → rest action queued', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20; // below threshold of 25
    employee.activeActionId = null; // idle

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(1);
    expect(result.inserted[0]!.employeeId).toBe(employee.id);
    expect(result.inserted[0]!.needKey).toBe('fatigue');

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
    expect(result.skipped).toHaveLength(0);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('fatigue above threshold → no action created', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 80;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('dead employee → skipped', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.alive = false;
    employee.fatigue = 20;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('injured employee → skipped', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.injured = true;
    employee.fatigue = 20;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('collapsing employee → skipped', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.collapsing = true;
    employee.fatigue = 20;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('employee with rest action already pending → skipped with reason', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20; // below threshold
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
    expect(result.skipped[0]!.needKey).toBe('fatigue');
    expect(result.skipped[0]!.reason).toBe('rest_action_already_queued');

    // Only the pre-existing action remains
    expect(state.pendingActions).toHaveLength(1);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('rest action shape validation', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20; // below threshold

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

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('nearest building selected', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20;

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

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('no building → target is employee position', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 7;
    employee.z = 13;
    employee.fatigue = 20; // below threshold

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

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it('boundary: gauge exactly at threshold (fatigue=25) → no action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = NEED_WARNING_THRESHOLDS.fatigue; // exactly 25

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────────
  it('insertion and skip results populated correctly for mixed scenario', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    // Employee A: exhausted
    const { employee: empA } = hireEmployee(state.employees, 'driller', rng);
    empA.x = 0;
    empA.z = 0;
    empA.fatigue = 20;
    empA.activeActionId = null;

    // Employee B: also exhausted, but already has a rest action pending
    const { employee: empB } = hireEmployee(state.employees, 'blaster', rng);
    empB.x = 0;
    empB.z = 0;
    empB.fatigue = 20;
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
    expect(result.inserted[0]!.needKey).toBe('fatigue');

    // Employee B must be skipped with reason
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.employeeId).toBe(empB.id);
    expect(result.skipped[0]!.needKey).toBe('fatigue');
    expect(result.skipped[0]!.reason).toBe('rest_action_already_queued');
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────────
  it('nextPendingActionId incremented after insertion', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const beforeId = state.nextPendingActionId;

    autoInsertNeedTasks(state);

    // nextPendingActionId must have been incremented (one rest action inserted)
    expect(state.nextPendingActionId).toBe(beforeId + 1);
  });

  // ── Test 14 ─────────────────────────────────────────────────────────────────
  it('adds need_warning to firedEvents when rest action already queued', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20; // below threshold
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

  // ── Test 15 ─────────────────────────────────────────────────────────────────
  it('emits employee:need_warning via emitter when insertion skipped', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20;
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

  // ── Test 16 ─────────────────────────────────────────────────────────────────
  it('does not emit need_warning when rest action is inserted', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20;
    employee.activeActionId = null;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const firedEvents: FiredEvent[] = [];
    autoInsertNeedTasks(state, firedEvents);

    expect(firedEvents).toHaveLength(0);
  });

  // ── Test 17 ─────────────────────────────────────────────────────────────────
  it('does not emit need_warning when fatigue is above threshold', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 80;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const firedEvents: FiredEvent[] = [];
    autoInsertNeedTasks(state, firedEvents);

    expect(firedEvents).toHaveLength(0);
  });

  // ── Test 18: no building to rest at → rest takes the no-building multiplier ─
  it('doubles the queued rest duration when no building services the need', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20; // below the warning threshold
    // No living_quarters placed — the employee will rest where they stand.

    autoInsertNeedTasks(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
    expect(restAction!.payload['restDuration']).toBe(
      NEED_REST_DURATIONS.fatigue * NEED_REST_NO_BUILDING_DURATION_MULTIPLIER,
    );
    expect(restAction!.payload['buildingId']).toBeUndefined();
  });

  // ── Test 19: a building in range keeps the base duration ────────────────────
  it('keeps the base rest duration when a building services the need', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    autoInsertNeedTasks(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction!.payload['restDuration']).toBe(NEED_REST_DURATIONS.fatigue);
  });

  // ── Test 20: employee already mid-rest → no second rest queued ──────────────
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
    employee.fatigue = 20; // still below the warning threshold — rest not finished yet
    employee.activeActionId = 7;      // claimed the rest action
    employee.restTicksRemaining = 2;  // ...and is mid-rest
    employee.restNeedKey = 'fatigue';
    // The claimed action is gone from pendingActions, as tickEmployees leaves it.

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(state.pendingActions.filter((a: PendingAction) => a.type === 'rest')).toHaveLength(0);
  });

  // ── #945: mid-task-execution guard ───────────────────────────────────────
  // An employee already arrived and mid-execution of a claimed task (e.g.
  // mid dig_ramp_segment) is marked by taskTicksRemaining !== null — distinct
  // from pendingTaskDuration !== null, which only covers the WALK to a
  // claimed job, not the work itself. Before #945, autoInsertNeedTasks
  // ignored taskTicksRemaining entirely and queued a proactive rest anyway;
  // the very next dispatch pass claims that queued rest and yanks the
  // employee (and, for a vehicle-gated task, its driver) off mid-task —
  // exactly the repeated dismount/reboard cycle the tutorial box-cut repro
  // (#945) hits on its rock-digger driver.

  // ── Test 21 ─────────────────────────────────────────────────────────────────
  it('#945: skips an employee mid-execution of a claimed task (taskTicksRemaining !== null) — no rest queued even with fatigue below threshold', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20; // below the warning threshold (25)
    employee.activeActionId = 42;
    employee.taskTicksRemaining = 4; // arrived, mid-execution of the claimed task

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(0);
    expect(state.pendingActions.filter((a: PendingAction) => a.type === 'rest')).toHaveLength(0);
    // The in-progress task itself must be untouched.
    expect(employee.taskTicksRemaining).toBe(4);
    expect(employee.activeActionId).toBe(42);
  });

  // ── Test 22 ─────────────────────────────────────────────────────────────────
  // Additive, not regressive: an employee mid-WALK to a claimed job
  // (pendingTaskDuration !== null, taskTicksRemaining still null — not yet
  // arrived) is queued exactly as before #945; only mid-execution is new.
  it('#945: still queues a rest for an employee mid-walk to a claimed job (pendingTaskDuration set, taskTicksRemaining still null) — additive, not regressive', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20; // below the warning threshold
    employee.activeActionId = 42;
    employee.pendingTaskDuration = 6; // walking to the claimed job, not yet arrived
    employee.taskTicksRemaining = null;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(1);
    expect(result.inserted[0]!.employeeId).toBe(employee.id);
    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
  });

  // ── Test 23 ─────────────────────────────────────────────────────────────────
  it('#945: once taskTicksRemaining returns to null (task complete) and fatigue is still below threshold, rest is inserted normally', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 20; // still below the warning threshold
    employee.activeActionId = null; // task completed, employee released back to idle
    employee.taskTicksRemaining = null;
    employee.pendingTaskDuration = null;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    const result = autoInsertNeedTasks(state);

    expect(result.inserted).toHaveLength(1);
    expect(result.inserted[0]!.employeeId).toBe(employee.id);
    expect(result.inserted[0]!.needKey).toBe('fatigue');
    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
  });
});
