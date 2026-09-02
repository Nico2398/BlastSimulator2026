// BlastSimulator2026 — Tests for tickNeedRestoration (auto-routing employees
// whose fatigue gauge drops below the warning threshold to a living_quarters
// building) and tickCollapse (relocated from GameLoop.test.ts, #759).
//
// #928: hunger and breakNeed removed — fatigue is the sole gauge every
// routing/collapse decision reads.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { tickNeedRestoration, tickCollapse } from '../../../src/core/engine/NeedRestoration.js';
import { tickEmployees } from '../../../src/core/engine/EmployeeDispatch.js';
import { autoInsertNeedTasks } from '../../../src/core/engine/NeedTaskInsertion.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import type { FiredEvent } from '../../../src/core/events/EventSystem.js';
import type { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import {
  NEED_REST_DURATIONS,
} from '../../../src/core/config/balance.js';


describe('tickNeedRestoration (Task 3.11)', () => {
  const SEED = 42;

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('routes a fatigued employee (fatigue < 25) to rest when a living_quarters is active', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'blaster', rng);
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

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('does NOT route an employee whose fatigue is comfortably above threshold', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    // Well above the threshold (25).
    employee.fatigue = 80;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100);

    const result = tickNeedRestoration(state);
    expect(result.routed).toHaveLength(0);
    expect(employee.activeActionId).toBeNull();
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('does NOT route an already-busy employee even when they are exhausted', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    // Employee is critically exhausted but already claimed a different action.
    employee.fatigue        = 5; // far below the threshold of 25
    employee.activeActionId = 99; // already busy

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100);

    const result = tickNeedRestoration(state);

    // Busy employees must be skipped entirely.
    expect(result.routed).toHaveLength(0);
    // The pre-existing activeActionId must remain untouched.
    expect(employee.activeActionId).toBe(99);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('adds employee to noBuilding when fatigue is below threshold but no living_quarters exists', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 20; // below the threshold of 25
    // No buildings placed — living_quarters is absent.

    const result = tickNeedRestoration(state);

    // With no available building, the employee cannot be routed.
    expect(result.noBuilding).toContain(employee.id);
    // Employee must NOT be assigned any action.
    expect(employee.activeActionId).toBeNull();
    // Result routed list must be empty.
    expect(result.routed).toHaveLength(0);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
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

  // ── Test 6 ──────────────────────────────────────────────────────────────────
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
    employee.fatigue  = 20; // below the threshold of 25

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

describe('tickCollapse (7.6)', () => {
  const SEED = 42;

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('collapsed employee gets rest PendingAction created', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 3;
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
    // The collapsed need must be 'fatigue' — the sole gauge (#928)
    expect(restAction!.payload.collapsedNeed).toBe('fatigue');
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('rest action targets the nearest living_quarters building', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 3;
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
    employee.fatigue = 3;
    employee.x = 0;
    employee.z = 0;

    // Building at (50,50) is > 20 cells from (0,0)
    placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100);

    tickCollapse(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest',
    );
    expect(restAction).toBeDefined();
    // restDuration must be doubled (base 8 × 2 = 16 for fatigue)
    expect(restAction!.payload.restDuration).toBe(NEED_REST_DURATIONS.fatigue * 2);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('no building at all → rest duration doubled, target is employee position', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 3;
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
    expect(restAction!.payload.restDuration).toBe(NEED_REST_DURATIONS.fatigue * 2);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('fatigue above threshold → no action created', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 50;

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
    employee.fatigue = 3;

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
    employee.fatigue = 3;

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
    employee.fatigue = 3;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toHaveLength(0);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('collapsed result contains employee IDs', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 3;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toEqual([employee.id]);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('fatigue-triggered collapse produces correct collapsedNeed and restDuration', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 3;     // Below fatigue threshold (5)
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
    employee.fatigue = 3;
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
    employee.fatigue = 3;
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
    employee.fatigue = 50;

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
    emp1.fatigue = 3;
    emp1.x = 0;
    emp1.z = 0;

    const { employee: emp2 } = hireEmployee(state.employees, 'blaster', rng);
    emp2.fatigue = 3;
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

  // ── NEW (#928) ──────────────────────────────────────────────────────────────
  // The walk-to-claimed-job survival guard added to ForceShiftRest.ts's two
  // proactive functions does NOT apply here: tickCollapse/checkCollapse is a
  // genuinely different code path (a real collapse, not a proactive nudge)
  // and must keep interrupting an employee in ANY state — including
  // mid-walk to an already-claimed job (pendingTaskDuration !== null) — the
  // instant fatigue crosses the collapse threshold. This path is untouched
  // by #928 and must not regress.
  it('interrupts an employee mid-walk to a claimed job (pendingTaskDuration !== null) when fatigue collapses', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 3; // below the collapse threshold (5)
    employee.activeActionId = 42; // claimed a job
    employee.pendingTaskDuration = 20; // walking to it, not yet arrived — 'traveling' state

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toEqual([employee.id]);
    expect(employee.collapsing).toBe(true);
    // The prior claim is released — collapse interrupts unconditionally,
    // regardless of the employee's travel state.
    expect(employee.activeActionId).not.toBe(42);
    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
  });

});
