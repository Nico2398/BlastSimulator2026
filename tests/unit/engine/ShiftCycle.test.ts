// BlastSimulator2026 — Tests for processShiftCycle: Tier-2+ Bunkhouse forced
// shift-rest cycling, both the legacy no-policy path and the applied-policy
// (#678) variant (relocated from GameLoop.test.ts, #759).

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { tickEmployeeMovement } from '../../../src/core/engine/EntityMovementTick.js';
import { tickArrivalGate } from '../../../src/core/engine/ArrivalGate.js';
import { tickCollapse } from '../../../src/core/engine/NeedRestoration.js';
import { autoInsertNeedTasks } from '../../../src/core/engine/NeedTaskInsertion.js';
import { processShiftCycle } from '../../../src/core/engine/ShiftCycle.js';
import { tickGeneralRestCompletion } from '../../../src/core/engine/RestCompletion.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import type { FiredEvent } from '../../../src/core/events/EventSystem.js';
import type { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import {
  NEED_REST_DURATIONS,
  NEED_WARNING_THRESHOLDS,
  WORK_DURATION_TICKS,
  SHIFT_SLEEP_DURATION_TICKS,
  NEED_REST_NO_BUILDING_DURATION_MULTIPLIER,
  SHIFT_DURATIONS_TICKS,
  BUILDING_REPLENISH_RATES,
} from '../../../src/core/config/balance.js';
import { createSitePolicy } from '../../../src/core/entities/SitePolicy.js';

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

  // ── Interrupted work is released for reclaim, not orphaned (#684) ─────────

  // forceShiftRestIfNeeded (the legacy, no-policy path exercised throughout
  // this suite — state.sitePolicy.revision stays 0, the default for every
  // fixture above) overwrites employee.activeActionId with the new rest
  // action's id directly, without ever releasing the action it replaces —
  // unlike its sibling forceShiftRestIfNeededByPolicy (#678, see the suite
  // below) and tickCollapse, both of which call interruptActiveAction first.
  // The interrupted action's record stays 'assigned' (or whatever in-flight
  // status it had)/holderId === employee.id forever: never completed (the
  // employee is resting, not ticking it) and never reclaimed (open-pool
  // dispatch only matches 'queued' actions), so the employee goes idle
  // permanently once the forced rest ends. This test fails on the old code
  // (action stays held by the employee, activeActionId overwritten with no
  // trace of it) and passes on the fix (action released to 'queued'/
  // holderId: null, its remaining duration preserved for whoever reclaims it
  // next).
  it('releases the interrupted active action back to the pool instead of orphaning it (#684)', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);
    expect(state.sitePolicy.revision).toBe(0); // no set_policy — the legacy path

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const interrupted: PendingAction = {
      id: 950,
      type: 'general_work',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 5, targetZ: 5, targetY: 0,
      payload: { note: 'drilling' },
      targetEmployeeId: null,
      status: 'in_progress',
      holderId: employee.id,
    };
    state.pendingActions.push(interrupted);
    employee.activeActionId = interrupted.id;
    employee.taskTicksRemaining = 4; // work already in progress, not merely claimed
    employee.ticksWorked = WORK_DURATION_TICKS - 1; // fires this call

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    processShiftCycle(state, []);

    // Released back to the pool — 'queued', unheld — not left 'assigned'/
    // held by an employee who is now resting and will never tick it again.
    const released = state.pendingActions.find(a => a.id === interrupted.id)!;
    expect(released.status).toBe('queued');
    expect(released.holderId).toBeNull();
    // Remaining work is preserved on the action itself so whoever reclaims
    // it resumes instead of restarting from scratch.
    expect(released.payload['durationTicks']).toBe(4);
    // The employee's activeActionId now points at the new rest action, not
    // the interrupted one and not null.
    expect(employee.activeActionId).not.toBe(interrupted.id);
    expect(employee.activeActionId).not.toBeNull();
  });
});

describe('processShiftCycle — under an applied policy (#678)', () => {
  const SEED = 42;

  /** Apply a policy the way set_policy does: bump revision, set shiftMode/thresholds. */
  function applyPolicy(state: GameState, overrides: Partial<SitePolicyLike> = {}): void {
    Object.assign(state.sitePolicy, overrides);
    state.sitePolicy.revision = (state.sitePolicy.revision ?? 0) + 1;
  }

  // Local alias purely for the overrides parameter's shape above — avoids a
  // second import of SitePolicy's own type under a different name.
  type SitePolicyLike = ReturnType<typeof createSitePolicy>;

  // ── No policy applied: revision stays 0 ───────────────────────────────────
  // The whole "processShiftCycle (7.9)" suite above already covers this
  // (every fixture there leaves state.sitePolicy at its fresh default,
  // revision 0) and none of its bodies are touched by this change — this
  // entry exists only to document the invariant, not to re-assert it.
  it('a fresh game state carries revision 0 by default — the opt-in gate the suite above relies on', () => {
    const state = createGame({ seed: SEED });
    expect(state.sitePolicy.revision).toBe(0);
  });

  // ── Shift-duration boundary (shift_8h) ─────────────────────────────────────

  it('does not fire one tick before the shift_8h boundary', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 111;
    // One tick before shift_8h - 1: this call's own increment brings
    // ticksWorked to shift_8h - 1 (7), still below the 8-tick boundary.
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h - 2;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    expect(employee.ticksWorked).toBe(SHIFT_DURATIONS_TICKS.shift_8h - 1);
    expect(result.shiftRested).not.toContain(employee.id);
    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.activeActionId).toBe(111);
  });

  it('fires exactly at the shift_8h boundary, using the policy shift-rest duration (not SHIFT_SLEEP_DURATION_TICKS)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 222;
    // This call's own increment brings ticksWorked to exactly shift_8h (8).
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h - 1;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    expect(employee.ticksWorked).toBe(SHIFT_DURATIONS_TICKS.shift_8h);
    expect(result.shiftRested).toContain(employee.id);
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.fatigue);
    expect(employee.pendingRestNeedKey).toBe('fatigue');
    expect(employee.activeActionId).not.toBe(222);
  });

  // ── Need-threshold boundaries ───────────────────────────────────────────────

  it('fires on hunger at exactly hungerRestThreshold, and NOT one point above it', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const threshold = state.sitePolicy.hungerRestThreshold;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const { employee: atThreshold } = hireEmployee(state.employees, 'driller', rng);
    atThreshold.activeActionId = 301;
    atThreshold.hunger = threshold;
    atThreshold.fatigue = 100;
    atThreshold.ticksWorked = 1; // nowhere near the shift boundary

    processShiftCycle(state, []);

    expect(atThreshold.pendingRestNeedKey).toBe('hunger');
    expect(atThreshold.pendingRestDuration).toBe(NEED_REST_DURATIONS.hunger);

    const { employee: aboveThreshold } = hireEmployee(state.employees, 'driller', rng);
    aboveThreshold.activeActionId = 302;
    aboveThreshold.hunger = threshold + 1;
    aboveThreshold.fatigue = 100;
    aboveThreshold.ticksWorked = 1;

    processShiftCycle(state, []);

    expect(aboveThreshold.pendingRestDuration).toBeNull();
    expect(aboveThreshold.activeActionId).toBe(302);
  });

  it('fires on fatigue at or below fatigueRestThreshold when hunger is healthy', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const threshold = state.sitePolicy.fatigueRestThreshold;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 400;
    employee.hunger = 100;
    employee.fatigue = threshold;
    employee.ticksWorked = 1;

    processShiftCycle(state, []);

    expect(employee.pendingRestNeedKey).toBe('fatigue');
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.fatigue);
  });

  // ── No living_quarters at all: not gated on building presence ─────────────

  // #678 follow-up (tutorial-playthrough regression): a policy-forced rest no
  // longer doubles for lacking a living_quarters — unlike tickCollapse/
  // autoInsertNeedTasks, whose NEED_REST_NO_BUILDING_DURATION_MULTIPLIER
  // penalizes genuine depletion to encourage building one. The policy's own
  // premise (forceShiftRestIfNeededByPolicy's doc comment) is that it
  // protects an employee regardless of site infrastructure — doubling the
  // rest on top of the real, already-uncompensated interruption cost
  // (interruptActiveAction releasing whatever task was in progress) taxed an
  // infrastructure-light site twice for the one condition the policy exists
  // to make survivable. tutorial_pit has no living_quarters at all, and its
  // own tutorial-playthrough.json scenario opts into shift_8h mid-drill —
  // the doubled duration compounded across repeated forced-rest cycles into
  // a scenario-breaking amount of lost drilling time.
  it('still forces rest with no living_quarters at all — rests in place, at the un-multiplied rest duration', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 500;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h - 1; // fires this call
    // No living_quarters placed anywhere.

    const firedEvents: FiredEvent[] = [];
    const result = processShiftCycle(state, firedEvents);

    expect(result.active).toBe(true);
    expect(result.shiftRested).toContain(employee.id);
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.fatigue);
    expect(employee.destinationX).toBe(employee.x);
    expect(employee.destinationZ).toBe(employee.z);
  });

  // ── Tier-1 living_quarters: routes to it, un-multiplied duration ──────────

  it('routes to a tier-1 living_quarters when one exists, with the un-multiplied rest duration', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 600;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h - 1; // fires this call

    // Placed away from the employee's own position (0,0) so a routed
    // destination is distinguishable from resting in place.
    const placed = placeBuilding(state.buildings, 'living_quarters', 30, 30, 100, 100, 1);
    expect(placed.success).toBe(true);

    const result = processShiftCycle(state, []);

    expect(result.shiftRested).toContain(employee.id);
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.fatigue); // not multiplied
    expect(employee.destinationX).not.toBe(employee.x);
    expect(employee.destinationZ).not.toBe(employee.z);
  });

  // ── Tier-2+ living_quarters: policy boundary supersedes the legacy one ────

  it('with a tier-2+ living_quarters, uses the policy shift boundary (8), not the legacy WORK_DURATION_TICKS (6)', () => {
    const state = createGame({ seed: SEED });
    state.buildings.unlockedTiers.living_quarters = 3;
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 700;
    // The legacy Tier-2+ boundary (WORK_DURATION_TICKS = 6) has already been
    // reached/passed, but the policy's own boundary (8) has not.
    employee.ticksWorked = WORK_DURATION_TICKS;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 2);

    const notYet = processShiftCycle(state, []);
    expect(notYet.shiftRested).not.toContain(employee.id);
    expect(employee.pendingRestDuration).toBeNull();

    // Now reach the policy's own boundary.
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h - 1;
    const result = processShiftCycle(state, []);

    expect(result.shiftRested).toContain(employee.id);
    // Policy-driven duration, not the legacy SHIFT_SLEEP_DURATION_TICKS constant
    // (both happen to equal 8 today, but this pins the *source*, not the value).
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.fatigue);
  });

  // ── Dead/injured employees are still skipped ──────────────────────────────

  it('dead employees are skipped under an applied policy', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.alive = false;
    employee.activeActionId = 800;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
    employee.hunger = 1;
    employee.fatigue = 1;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const result = processShiftCycle(state, []);

    expect(result.shiftRested).not.toContain(employee.id);
    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.pendingRestDuration).toBeNull();
  });

  it('injured employees are skipped under an applied policy', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.injured = true;
    employee.activeActionId = 801;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
    employee.hunger = 1;
    employee.fatigue = 1;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const result = processShiftCycle(state, []);

    expect(result.shiftRested).not.toContain(employee.id);
    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.pendingRestDuration).toBeNull();
  });

  // ── continuous / custom shift modes under a policy ─────────────────────────

  it("'continuous' mode never force-rests purely from ticksWorked — only from need thresholds", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'continuous' });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 900;
    employee.ticksWorked = 9999; // massive — continuous has no shift-duration boundary
    employee.hunger = 100;
    employee.fatigue = 100;

    processShiftCycle(state, []);
    expect(employee.pendingRestDuration).toBeNull();

    // Now cross a need threshold — this alone must fire under 'continuous'.
    employee.hunger = state.sitePolicy.hungerRestThreshold - 1;
    processShiftCycle(state, []);

    expect(employee.pendingRestNeedKey).toBe('hunger');
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.hunger);
  });

  it("'custom' mode honours per-employee customThresholds", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'custom' });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    state.sitePolicy.customThresholds[employee.id] = { hunger: 70, fatigue: 10, social: 10 };
    employee.activeActionId = 950;
    employee.ticksWorked = 1;
    // Below the custom hunger threshold (70) but above the policy-level
    // default (40) — only the per-employee override explains a fire here.
    employee.hunger = 60;
    employee.fatigue = 100;

    processShiftCycle(state, []);

    expect(employee.pendingRestNeedKey).toBe('hunger');
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.hunger);
  });

  // ── employee_shift_change event still fires under the policy path ─────────

  it('fires employee_shift_change (firedEvents and emitter) under the policy path', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 1000;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h - 1;

    const events: string[] = [];
    const mockEmitter = { emit: (event: string) => { events.push(event); } } as unknown as EventEmitter;
    const firedEvents: FiredEvent[] = [];

    processShiftCycle(state, firedEvents, mockEmitter);

    expect(firedEvents.some(e => e.eventId === 'employee_shift_change')).toBe(true);
    expect(events).toContain('employee:shift_change');
  });

  // ── Completion: gauge replenishment differs by building tier ──────────────

  it('replenishes the resting gauge per BUILDING_REPLENISH_RATES tier once forced rest completes, then returns to normal dispatch', () => {
    function runToCompletion(tier: 1 | 2 | 3): { fatigueAfter: number; activeActionId: number | null } {
      const state = createGame({ seed: SEED });
      const rng = new Random(SEED);
      applyPolicy(state, { shiftMode: 'shift_8h' });
      state.buildings.unlockedTiers.living_quarters = 3;
      // Co-located with the employee (0,0) so arrival resolves in one step
      // (mirrors this file's own resolveArrival doc comment).
      placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, tier);

      const { employee } = hireEmployee(state.employees, 'driller', rng);
      employee.activeActionId = 1100;
      employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h - 1; // fires this call
      employee.fatigue = 10;

      processShiftCycle(state, []); // fires forced rest via the applied policy
      resolveArrival(state); // promotes pendingRestDuration/NeedKey -> restTicksRemaining/restNeedKey

      // Directly collapse the rest to its final tick — permitted per this
      // feature's own acceptance criteria ("directly set restTicksRemaining/
      // restNeedKey and invoke the completion path used elsewhere in this file").
      employee.restTicksRemaining = 1;
      tickGeneralRestCompletion(state);

      return { fatigueAfter: employee.fatigue, activeActionId: employee.activeActionId };
    }

    const tier1 = runToCompletion(1);
    const tier2 = runToCompletion(2);

    // The rate applies for the rest's own full duration (#700 fix) — a single
    // tick's worth used to net negative against any real travel to and from
    // the building, so this now matches BUILDING_REPLENISH_RATES's own
    // "per-tick" doc comment instead of a flat one-shot bonus. Starting well
    // below the ceiling (10) so tier 1's smaller total (8 × 8 ticks = 64)
    // stays under 100 while tier 2's larger one (14 × 8 = 112) saturates —
    // still two distinct, tier-differentiated outcomes.
    expect(tier1.fatigueAfter).toBe(Math.min(100, 10 + BUILDING_REPLENISH_RATES.fatigue[1] * NEED_REST_DURATIONS.fatigue));
    expect(tier2.fatigueAfter).toBe(Math.min(100, 10 + BUILDING_REPLENISH_RATES.fatigue[2] * NEED_REST_DURATIONS.fatigue));
    expect(tier1.fatigueAfter).not.toBe(tier2.fatigueAfter);
    expect(tier1.activeActionId).toBeNull();
    expect(tier2.activeActionId).toBeNull();
  });

  // ── Interrupted work is released for reclaim, not orphaned (tutorial-playthrough regression) ──

  // tutorial-playthrough.json (scripts/scenario-defs/) opts into shift_8h
  // mid-drill: before this fix, forceShiftRestIfNeededByPolicy overwrote
  // employee.activeActionId with the new rest action's id directly, without
  // ever releasing the drill_hole action it replaced — unlike tickCollapse,
  // which calls interruptActiveAction for exactly this reason. The
  // interrupted action's record stayed 'assigned'/holderId === employee.id
  // forever: never completed (the employee was now resting, not ticking it)
  // and never reclaimed (the open-pool query only matches 'queued' actions),
  // so the employee went idle permanently once the forced rest ended and the
  // work they were doing never finished — a driller left with 3 of 4 holes
  // stuck ordered forever, cascading into every step downstream of it. This
  // test fails on the old code (action stays 'assigned', held by the
  // employee, activeActionId overwritten with no trace of it) and passes on
  // the fix (action released to 'queued'/holderId: null, its remaining
  // duration preserved on the payload for whoever reclaims it next).
  it('releases the interrupted active action back to the pool instead of orphaning it', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const interrupted: PendingAction = {
      id: 900,
      type: 'general_work',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 5, targetZ: 5, targetY: 0,
      payload: { note: 'drilling' },
      targetEmployeeId: null,
      status: 'in_progress',
      holderId: employee.id,
    };
    state.pendingActions.push(interrupted);
    employee.activeActionId = interrupted.id;
    employee.taskTicksRemaining = 4; // work already in progress, not merely claimed
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h - 1; // fires this call

    processShiftCycle(state, []);

    // Released back to the pool — 'queued', unheld — not left 'assigned'/
    // held by an employee who is now resting and will never tick it again.
    const released = state.pendingActions.find(a => a.id === interrupted.id)!;
    expect(released.status).toBe('queued');
    expect(released.holderId).toBeNull();
    // Remaining work is preserved on the action itself so whoever reclaims
    // it resumes instead of restarting from scratch.
    expect(released.payload['durationTicks']).toBe(4);
    // The employee's activeActionId now points at the new rest action, not
    // the interrupted one and not null.
    expect(employee.activeActionId).not.toBe(interrupted.id);
    expect(employee.activeActionId).not.toBeNull();
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it('does not requeue an employee already mid-walk to a queued policy rest', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const CLAIMED_ACTION_ID = 1200;
    employee.activeActionId = CLAIMED_ACTION_ID;
    employee.pendingRestDuration = NEED_REST_DURATIONS.hunger;
    employee.pendingRestNeedKey = 'hunger';
    // Every trigger condition is also satisfied, to prove the guard — not
    // the absence of a reason to fire — is what stops a second queue.
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
    employee.hunger = 1;
    employee.fatigue = 1;

    processShiftCycle(state, []);

    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.hunger);
    expect(employee.pendingRestNeedKey).toBe('hunger');
    expect(employee.activeActionId).toBe(CLAIMED_ACTION_ID);
  });

  it('skips an employee already resting (restTicksRemaining !== null)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 1300;
    employee.restTicksRemaining = 5;
    employee.restNeedKey = 'fatigue'; // owned by tickGeneralRestCompletion, not this pass
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h; // would otherwise refire
    employee.hunger = 1;
    employee.fatigue = 1;

    processShiftCycle(state, []);

    // Untouched by this pass — still owned by the general rest-completion path.
    expect(employee.restTicksRemaining).toBe(5);
    expect(employee.activeActionId).toBe(1300);
  });

  // #707: previously "never force-rests an idle employee" — an idle employee
  // (nothing claimed yet, not mid-task) has nothing for interruptActiveAction
  // to release, but that is not a reason to skip them: they still have
  // hunger/fatigue gauges draining, and skipping them here left them to the
  // much lower reactive NEED_WARNING_THRESHOLDS (autoInsertNeedTasks) instead
  // of this policy's own configured (higher, proactive) thresholds — a long
  // enough idle stretch (waiting for work that doesn't exist yet, e.g. a
  // second qualified employee with nothing to do until a first one finishes
  // drilling) crashed morale well before any work-driven trigger got a
  // chance, which is what let a genuine worker_revolt fire during
  // tutorial-interactive.json's own pre-blast charging grind (#707) — the
  // crew's morale was already at rock bottom from the idle wait, not from
  // the charging work itself. This test fails on the old code (idle skipped
  // outright, no rest ever queued no matter how depleted) and passes on the
  // fix (idle employees are evaluated exactly like working ones).
  it('force-rests an idle employee (activeActionId === null) exactly like a working one', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = null;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10;
    employee.hunger = 1;
    employee.fatigue = 1;

    processShiftCycle(state, []);

    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.pendingRestDuration).not.toBeNull();
    expect(employee.activeActionId).not.toBeNull();
  });

  it('does not disturb an idle employee mid-walk to board a vehicle (pendingDriverVehicleId set)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = null;
    employee.pendingDriverVehicleId = 7;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10;
    employee.hunger = 1;
    employee.fatigue = 1;

    processShiftCycle(state, []);

    expect(employee.pendingDriverVehicleId).toBe(7);
    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.activeActionId).toBeNull();
  });
});
