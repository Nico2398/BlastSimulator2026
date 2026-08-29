// BlastSimulator2026 — Direct unit tests for ForceShiftRest.ts's forced-rest
// functions (#813). Promoted from module-private to `export function` purely
// so GameLoop.ts's #759 split could call them from ShiftCycle.ts across
// files — behavior is unchanged from before the split (already exercised
// indirectly via processShiftCycle in ShiftCycle.test.ts) — this file is the
// mirrored-path direct coverage core-purity.md requires for every exported
// src/core/ function.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { forceShiftRestIfNeeded, forceShiftRestIfNeededByPolicy } from '../../../src/core/engine/ForceShiftRest.js';
import { createSitePolicy } from '../../../src/core/entities/SitePolicy.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import type { FiredEvent } from '../../../src/core/events/EventSystem.js';
import type { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import {
  WORK_DURATION_TICKS, SHIFT_SLEEP_DURATION_TICKS, NEED_REST_DURATIONS, SHIFT_DURATIONS_TICKS,
} from '../../../src/core/config/balance.js';

const SEED = 42;

/** Push a claimed, in-progress action `employee` is actively working. */
function pushHeldAction(state: GameState, employeeId: number, id: number): PendingAction {
  const action: PendingAction = {
    id, type: 'general_work', requiredSkill: null, requiredVehicleRole: null,
    targetX: 5, targetZ: 5, targetY: 0, payload: { note: 'work' },
    targetEmployeeId: null, status: 'in_progress', holderId: employeeId,
  };
  state.pendingActions.push(action);
  return action;
}

describe('forceShiftRestIfNeeded (legacy, fatigue-only, fixed-duration path)', () => {
  it('releases the prior action, queues+self-claims a new rest action, seeds SHIFT_SLEEP_DURATION_TICKS, records shiftRested/firedEvents, and emits', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const prior = pushHeldAction(state, employee.id, 100);
    employee.activeActionId = prior.id;
    employee.ticksWorked = WORK_DURATION_TICKS;

    const firedEvents: FiredEvent[] = [];
    const shiftRested: number[] = [];
    const events: string[] = [];
    const mockEmitter = { emit: (e: string) => { events.push(e); } } as unknown as EventEmitter;

    forceShiftRestIfNeeded(state, employee, firedEvents, shiftRested, mockEmitter);

    const releasedPrior = state.pendingActions.find(a => a.id === 100)!;
    expect(releasedPrior.status).toBe('queued');
    expect(releasedPrior.holderId).toBeNull();

    expect(employee.pendingRestDuration).toBe(SHIFT_SLEEP_DURATION_TICKS);
    expect(shiftRested).toContain(employee.id);
    expect(firedEvents.map(e => e.eventId)).toContain('employee_shift_change');
    expect(events).toContain('employee:shift_change');

    expect(employee.activeActionId).not.toBe(100);
    expect(employee.activeActionId).not.toBeNull();
    const restAction = state.pendingActions.find(a => a.id === employee.activeActionId)!;
    expect(restAction.type).toBe('rest');
    expect(restAction.status).toBe('assigned');
    expect(restAction.holderId).toBe(employee.id);
  });

  it('routes to a living_quarters destination when one exists away from the employee', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 200;
    employee.ticksWorked = WORK_DURATION_TICKS;
    state.buildings.unlockedTiers.living_quarters = 3; // tier 2 requires research unlock
    placeBuilding(state.buildings, 'living_quarters', 30, 30, 100, 100, 2);

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(employee.destinationX).not.toBe(employee.x);
    expect(employee.destinationZ).not.toBe(employee.z);
  });

  it('rests in place when no living_quarters exists at all', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 300;
    employee.ticksWorked = WORK_DURATION_TICKS;

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(employee.destinationX).toBe(employee.x);
    expect(employee.destinationZ).toBe(employee.z);
  });

  it('no-op when restTicksRemaining is already set', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 400;
    employee.ticksWorked = WORK_DURATION_TICKS;
    employee.restTicksRemaining = 3;

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.activeActionId).toBe(400);
  });

  it('no-op when pendingRestDuration is already set (mid-walk to a queued rest)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 500;
    employee.ticksWorked = WORK_DURATION_TICKS;
    employee.pendingRestDuration = 4;

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(employee.pendingRestDuration).toBe(4); // unchanged, not re-queued
    expect(employee.activeActionId).toBe(500);
  });

  it('no-op when activeActionId is null', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = null;
    employee.ticksWorked = WORK_DURATION_TICKS;

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.activeActionId).toBeNull();
  });

  it('no-op when ticksWorked is below WORK_DURATION_TICKS', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 600;
    employee.ticksWorked = WORK_DURATION_TICKS - 1;

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.activeActionId).toBe(600);
  });
});

describe('forceShiftRestIfNeededByPolicy (#678 policy-aware variant)', () => {
  type SitePolicyLike = ReturnType<typeof createSitePolicy>;

  /** Apply a policy the way set_policy does: bump revision, set shiftMode/thresholds. */
  function applyPolicy(state: GameState, overrides: Partial<SitePolicyLike> = {}): void {
    Object.assign(state.sitePolicy, overrides);
    state.sitePolicy.revision = (state.sitePolicy.revision ?? 0) + 1;
  }

  it('fires on the shift-duration boundary, using NEED_REST_DURATIONS[needKey] (not SHIFT_SLEEP_DURATION_TICKS)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 100;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
    employee.hunger = 100;
    employee.fatigue = 100; // gauges tied at default thresholds -> tie-break picks 'fatigue'

    const firedEvents: FiredEvent[] = [];
    const shiftRested: number[] = [];
    forceShiftRestIfNeededByPolicy(state, employee, firedEvents, shiftRested);

    expect(shiftRested).toContain(employee.id);
    expect(employee.pendingRestNeedKey).toBe('fatigue');
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.fatigue);
    expect(firedEvents.map(e => e.eventId)).toContain('employee_shift_change');
  });

  it('fires on a hunger-threshold trigger', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const threshold = state.sitePolicy.hungerRestThreshold;
    employee.activeActionId = 200;
    employee.ticksWorked = 1; // nowhere near the shift boundary
    employee.hunger = threshold;
    employee.fatigue = 100;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestNeedKey).toBe('hunger');
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.hunger);
  });

  it('fires on a fatigue-threshold trigger', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const threshold = state.sitePolicy.fatigueRestThreshold;
    employee.activeActionId = 210;
    employee.ticksWorked = 1;
    employee.hunger = 100;
    employee.fatigue = threshold;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestNeedKey).toBe('fatigue');
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.fatigue);
  });

  it('picks hunger as the more-overdue gauge when both are past threshold (deficit tie-break)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 300;
    employee.ticksWorked = 1;
    employee.hunger = 30;  // deficit vs. default threshold 60: -30
    employee.fatigue = 50; // deficit: -10 — less overdue than hunger

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestNeedKey).toBe('hunger');
  });

  it('picks fatigue as the more-overdue gauge when it is further past threshold than hunger', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 301;
    employee.ticksWorked = 1;
    employee.hunger = 50;  // deficit: -10
    employee.fatigue = 20; // deficit: -40 — more overdue

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestNeedKey).toBe('fatigue');
  });

  it('no-op when restTicksRemaining is already set', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 700;
    employee.restTicksRemaining = 5;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
    employee.hunger = 1;
    employee.fatigue = 1;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.activeActionId).toBe(700);
  });

  it('no-op when pendingRestDuration is already set (mid-walk to a queued policy rest)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 800;
    employee.pendingRestDuration = NEED_REST_DURATIONS.hunger;
    employee.pendingRestNeedKey = 'hunger';
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
    employee.hunger = 1;
    employee.fatigue = 1;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.hunger);
    expect(employee.pendingRestNeedKey).toBe('hunger');
    expect(employee.activeActionId).toBe(800);
  });

  it('no-op when pendingDriverVehicleId is set (mid-walk to board a vehicle)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = null;
    employee.pendingDriverVehicleId = 9;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10;
    employee.hunger = 1;
    employee.fatigue = 1;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingDriverVehicleId).toBe(9);
    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.activeActionId).toBeNull();
  });

  it('no-op when shouldForceRest itself returns false', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'continuous' }); // no shift-duration boundary
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 900;
    employee.ticksWorked = 9999;
    employee.hunger = 100;
    employee.fatigue = 100; // both healthy — nothing to trigger

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.activeActionId).toBe(900);
  });

  it('#707: force-rests an idle employee (activeActionId === null) exactly like a working one', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = null;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10;
    employee.hunger = 1;
    employee.fatigue = 1;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.pendingRestDuration).not.toBeNull();
    expect(employee.activeActionId).not.toBeNull();
  });

  it('routes to a tier-1 living_quarters when one exists (unlike the legacy tier>=2-only caller gate)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 400;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
    placeBuilding(state.buildings, 'living_quarters', 30, 30, 100, 100, 1);

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.destinationX).not.toBe(employee.x);
    expect(employee.destinationZ).not.toBe(employee.z);
  });

  it('rests in place with no living_quarters at all, at the un-multiplied NEED_REST_DURATIONS[needKey]', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 500;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
    employee.hunger = 100;
    employee.fatigue = 100; // tie -> 'fatigue', matches the shift-duration test above

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.destinationX).toBe(employee.x);
    expect(employee.destinationZ).toBe(employee.z);
    // Un-multiplied — no NEED_REST_NO_BUILDING_DURATION_MULTIPLIER applied,
    // unlike tickCollapse/autoInsertNeedTasks' own no-building rest.
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.fatigue);
  });

  it('releases the previously active action back to the pool before claiming the rest action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const prior = pushHeldAction(state, employee.id, 1000);
    employee.activeActionId = prior.id;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    const released = state.pendingActions.find(a => a.id === 1000)!;
    expect(released.status).toBe('queued');
    expect(released.holderId).toBeNull();
    expect(employee.activeActionId).not.toBe(1000);
    expect(employee.activeActionId).not.toBeNull();
  });
});
