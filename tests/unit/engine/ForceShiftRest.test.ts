// BlastSimulator2026 — Direct unit tests for ForceShiftRest.ts's forced-rest
// functions (#813). Promoted from module-private to `export function` purely
// so GameLoop.ts's #759 split could call them from ShiftCycle.ts across
// files — behavior is unchanged from before the split (already exercised
// indirectly via processShiftCycle in ShiftCycle.test.ts) — this file is the
// mirrored-path direct coverage core-purity.md requires for every exported
// src/core/ function.
//
// #928: hunger/breakNeed removed — fatigue is the sole gauge, so the old
// multi-gauge deficit tie-break tests are gone (there is nothing left to
// tie-break between). New in this file: both functions now also early-return
// when `pendingTaskDuration !== null` — an employee mid-walk to an
// already-claimed job is left alone rather than yanked into a proactive
// rest; a genuine collapse (tickCollapse/checkCollapse, a separate code
// path) still interrupts unconditionally.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
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

  // NEW (#928): mirrors the pendingRestDuration guard immediately above, for
  // the task-travel case — an employee mid-walk to an already-claimed job
  // must not be pulled into rest, whatever their fatigue or ticksWorked.
  it('no-op when pendingTaskDuration is already set (mid-walk to a claimed job)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const prior = pushHeldAction(state, employee.id, 550);
    employee.activeActionId = prior.id;
    employee.ticksWorked = WORK_DURATION_TICKS;
    employee.pendingTaskDuration = 12; // walking to the claimed job, not yet arrived

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.pendingTaskDuration).toBe(12); // untouched
    expect(employee.activeActionId).toBe(550); // claim survives, not released
    const claim = state.pendingActions.find(a => a.id === 550)!;
    expect(claim.status).toBe('in_progress');
    expect(claim.holderId).toBe(employee.id);
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

  // NEW (#945): an employee already arrived and mid-execution of a claimed
  // task (taskTicksRemaining !== null) must not be pulled into a forced
  // shift rest — distinct from the pendingTaskDuration guard above, which
  // only covers the WALK to a claimed job, not the work itself once arrived.
  // Without this guard, a rock-digger driver mid dig_ramp_segment gets
  // yanked off its vehicle the instant WORK_DURATION_TICKS is crossed,
  // dismounting and re-boarding repeatedly (#945's tutorial box-cut repro).
  it('#945: no-op when taskTicksRemaining is set (mid-execution of a claimed, arrived task)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const prior = pushHeldAction(state, employee.id, 650);
    employee.activeActionId = prior.id;
    employee.ticksWorked = WORK_DURATION_TICKS;
    employee.taskTicksRemaining = 4; // arrived, mid-execution — not just walking to it

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.taskTicksRemaining).toBe(4); // untouched
    expect(employee.activeActionId).toBe(650); // claim survives, not released
    const claim = state.pendingActions.find(a => a.id === 650)!;
    expect(claim.status).toBe('in_progress');
    expect(claim.holderId).toBe(employee.id);
  });
});

describe('forceShiftRestIfNeededByPolicy (#678 policy-aware variant)', () => {
  type SitePolicyLike = ReturnType<typeof createSitePolicy>;

  /** Apply a policy the way set_policy does: bump revision, set shiftMode/thresholds. */
  function applyPolicy(state: GameState, overrides: Partial<SitePolicyLike> = {}): void {
    Object.assign(state.sitePolicy, overrides);
    state.sitePolicy.revision = (state.sitePolicy.revision ?? 0) + 1;
  }

  it('fires on the shift-duration boundary, using NEED_REST_DURATIONS.fatigue (not SHIFT_SLEEP_DURATION_TICKS)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 100;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
    employee.fatigue = 100;

    const firedEvents: FiredEvent[] = [];
    const shiftRested: number[] = [];
    forceShiftRestIfNeededByPolicy(state, employee, firedEvents, shiftRested);

    expect(shiftRested).toContain(employee.id);
    expect(employee.pendingRestNeedKey).toBe('fatigue');
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.fatigue);
    expect(firedEvents.map(e => e.eventId)).toContain('employee_shift_change');
  });

  it('fires on a fatigue-threshold trigger', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const threshold = state.sitePolicy.fatigueRestThreshold;
    employee.activeActionId = 210;
    employee.ticksWorked = 1;
    employee.fatigue = threshold;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestNeedKey).toBe('fatigue');
    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.fatigue);
  });

  it('no-op when restTicksRemaining is already set', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 700;
    employee.restTicksRemaining = 5;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
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
    employee.pendingRestDuration = NEED_REST_DURATIONS.fatigue;
    employee.pendingRestNeedKey = 'fatigue';
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
    employee.fatigue = 1;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestDuration).toBe(NEED_REST_DURATIONS.fatigue);
    expect(employee.pendingRestNeedKey).toBe('fatigue');
    expect(employee.activeActionId).toBe(800);
  });

  // NEW (#928): the walk-to-claimed-job survival guard — a proactive
  // policy-triggered rest must not interrupt an employee already mid-walk to
  // a claimed job, even when fatigue is deep below threshold and the shift
  // boundary has long since passed. The claim (and its pending travel) must
  // still be intact after the call.
  it('no-op when pendingTaskDuration is already set (mid-walk to a claimed job), even with fatigue deep below threshold', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const prior = pushHeldAction(state, employee.id, 850);
    employee.activeActionId = prior.id;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10; // well past the shift boundary
    employee.fatigue = 1; // well below any threshold
    employee.pendingTaskDuration = 9; // walking to the claimed job, not yet arrived

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.pendingRestNeedKey).toBeNull();
    expect(employee.pendingTaskDuration).toBe(9); // untouched
    expect(employee.activeActionId).toBe(850); // claim survives, not released
    const claim = state.pendingActions.find(a => a.id === 850)!;
    expect(claim.status).toBe('in_progress');
    expect(claim.holderId).toBe(employee.id);
  });

  it('no-op when pendingDriverVehicleId is set (mid-walk to board a vehicle)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = null;
    employee.pendingDriverVehicleId = 9;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10;
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
    employee.fatigue = 100; // healthy — nothing to trigger

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

  it('rests in place with no living_quarters at all, at the un-multiplied NEED_REST_DURATIONS.fatigue', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 500;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
    employee.fatigue = 100;

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

  // NEW (#945, fixer follow-up): mirrors forceShiftRestIfNeeded's own
  // taskTicksRemaining guard, but scoped to vehicle-gated work
  // (isMidVehicleGatedWork, VehicleReservation.ts) rather than a blanket
  // taskTicksRemaining check — a policy-forced rest must not preempt a
  // driver already boarded and mid-execution of a vehicle-gated action
  // (e.g. mid dig_ramp_segment), even with fatigue deep below any threshold
  // and the shift boundary long since passed. Only a genuine collapse
  // (tickCollapse, NeedRestoration.ts) is still allowed to interrupt
  // mid-task — that path is untouched by #945.
  it('#945: no-op when boarded and mid-execution of a vehicle-gated action (taskTicksRemaining set), even with fatigue deep below threshold', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const prior = pushHeldAction(state, employee.id, 1100);
    prior.requiredVehicleRole = 'rock_digger';
    vehicle.driverId = employee.id;
    vehicle.reservedForActionId = prior.id;
    employee.activeActionId = prior.id;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10; // well past the shift boundary
    employee.fatigue = 1; // well below any threshold
    employee.taskTicksRemaining = 3; // arrived, mid-execution — not just driving to it

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.pendingRestNeedKey).toBeNull();
    expect(employee.taskTicksRemaining).toBe(3); // untouched
    expect(employee.activeActionId).toBe(1100); // claim survives, not released
    const claim = state.pendingActions.find(a => a.id === 1100)!;
    expect(claim.status).toBe('in_progress');
    expect(claim.holderId).toBe(employee.id);
  });

  // NEW (#945 fixer follow-up): the mid-execution guard above is
  // deliberately narrower than "any vehicle-gated action" — a driver still
  // en route to the target (taskTicksRemaining not yet seeded by
  // ArrivalGate) stays interruptible, same as #922's own pinned
  // mid-drive-interruption behavior for the legacy forceShiftRestIfNeeded
  // (VehicleReservation.test.ts). Protecting the drive phase too was tried
  // and empirically made things worse on #945's own tutorial box-cut repro
  // (needs.integration.test.ts): an equal boarding count, but the driver's
  // fatigue crashing all the way to tickCollapse's floor instead of resting
  // at the policy's own higher threshold — see forceShiftRestIfNeededByPolicy's
  // own inline comment on the guard.
  it('#945 follow-up: DOES interrupt a boarded vehicle-gated action while still mid-drive (taskTicksRemaining still null) — only mid-execution is protected', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const prior = pushHeldAction(state, employee.id, 1101);
    prior.requiredVehicleRole = 'rock_digger';
    vehicle.driverId = employee.id;
    vehicle.reservedForActionId = prior.id;
    employee.activeActionId = prior.id;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10;
    employee.fatigue = 1;
    // taskTicksRemaining stays null — still driving toward the target.

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestDuration).not.toBeNull();
    expect(employee.activeActionId).not.toBe(1101);
  });

  // NEW (#945 fixer follow-up): the guard is scoped to vehicle-gated work —
  // an on-foot (non-vehicle) task stays interruptible mid-execution, same as
  // before #945. A blanket taskTicksRemaining guard (an earlier, broader
  // version of this fix) also deferred a policy-forced rest for a long-
  // running on-foot task's entire duration, letting fatigue swing far past
  // the policy's own threshold every work cycle and crash morale over a long
  // run — regressing needs.integration.test.ts's own pre-existing "#678"
  // long-run wellBeing/revolt acceptance cases.
  it('#945 follow-up: DOES interrupt a non-vehicle task mid-execution (taskTicksRemaining set) — only vehicle-gated work is protected', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const prior = pushHeldAction(state, employee.id, 1102); // general_work, requiredVehicleRole: null
    employee.activeActionId = prior.id;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10;
    employee.fatigue = 1;
    employee.taskTicksRemaining = 3;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestDuration).not.toBeNull();
    expect(employee.activeActionId).not.toBe(1102);
  });
});
