// BlastSimulator2026 — Tests for autoInsertNeedTasks: proactive rest-task
// insertion for employees below need warning thresholds (relocated from
// GameLoop.test.ts, #759).

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
  NEED_REST_COSTS,
  NEED_REST_NO_BUILDING_DURATION_MULTIPLIER,
} from '../../../src/core/config/balance.js';

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
