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
import { purchaseVehicle, vehicleDriverId } from '../../../src/core/entities/Vehicle.js';
import { forceShiftRestIfNeeded, forceShiftRestIfNeededByPolicy } from '../../../src/core/engine/ForceShiftRest.js';
import { createSitePolicy } from '../../../src/core/entities/SitePolicy.js';
import { computeEmployeeActivity } from '../../../src/core/entities/EmployeeActivity.js';
import type { ActionType, PendingAction } from '../../../src/core/state/GameState.js';
import type { FiredEvent } from '../../../src/core/events/EventSystem.js';
import type { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import {
  WORK_DURATION_TICKS, SHIFT_SLEEP_DURATION_TICKS, NEED_REST_DURATIONS, SHIFT_DURATIONS_TICKS,
} from '../../../src/core/config/balance.js';

const SEED = 42;

/**
 * Push a claimed, in-progress action `employee` is actively working.
 * `type` defaults to 'general_work' (#1039: extended to accept any
 * ActionType, e.g. 'place_building', so construction-interruption guard
 * tests can reuse this same helper — backward compatible with every
 * pre-existing 3-arg call site).
 */
function pushHeldAction(state: GameState, employeeId: number, id: number, type: ActionType = 'general_work'): PendingAction {
  const action: PendingAction = {
    id, type, requiredSkill: null, requiredVehicleRole: null,
    targetX: 5, targetZ: 5, targetY: 0, payload: { note: 'work' },
    targetEmployeeId: null, status: 'in_progress', holderId: employeeId,
    queuedAtTick: 0,
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

  // #1013: computeEmployeeActivity must report actionType: 'rest' the
  // instant finishForceRest starts the walk — the same pictogram-
  // distinguishability bug NeedRestoration.test.ts's own #1013 tests pin for
  // the other rest-dispatch call sites. finishForceRest sets destinationX/Z
  // directly without touching pendingActionType today, so this reads null
  // instead of 'rest' until beginRestWalk is wired in.
  it('#1013: reports actionType "rest" via computeEmployeeActivity while walking to the living_quarters', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 200;
    employee.ticksWorked = WORK_DURATION_TICKS;
    state.buildings.unlockedTiers.living_quarters = 3;
    placeBuilding(state.buildings, 'living_quarters', 30, 30, 100, 100, 2);

    forceShiftRestIfNeeded(state, employee, [], []);

    const activity = computeEmployeeActivity(employee, state.vehicles.vehicles);
    expect(activity.kind).toBe('walking');
    expect(activity.actionType).toBe('rest');
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

  // #1118: finishForceRest (this function's shared tail with the policy
  // variant) routes through beginRestTravel (RestActionHelpers.ts) instead
  // of beginRestWalk — a mounted employee forced into a shift rest keeps
  // driving the vehicle they're in, rather than desyncing their position
  // from it (I2_mounted_position_mismatch) the way a plain destinationX/Z
  // field-write would.
  it('#1118: a mounted employee forced into shift rest stays mounted, with a drive-leg itinerary installed toward the rest target, no forced alight', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const prior = pushHeldAction(state, employee.id, 1130);
    employee.activeActionId = prior.id;
    employee.ticksWorked = WORK_DURATION_TICKS;

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(employee.itinerary).not.toBeNull();
    const driveLeg = employee.itinerary!.legs.find(l => l.mode === 'drive');
    expect(driveLeg).toBeDefined();
    expect(driveLeg!.vehicleId).toBe(vehicle.id);
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

  // #1042: an employee mid-evacuation-drive (boarded a driverless vehicle,
  // driving it clear) has activeActionId === null — mirrors the
  // pendingDriverVehicleId guard just above, but for a drive rather than a
  // walk-to-board.
  it('no-op when the employee is mid-evacuation-drive (boarded a driverless vehicle, driving it clear) (#1042)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = null;
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    vehicle.occupantIds = [employee.id];
    // Mid-evacuation-drive is read off the driver's own itinerary since
    // #1092: a `reposition` goal whose last leg puts them back on foot, the
    // shape only clearZone (Zone.ts) ever plans.
    employee.itinerary = {
      goal: { kind: 'reposition', x: 40, z: 40 },
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 40, destZ: 40,
        arrival: 'exact', onArrive: { kind: 'alight' }, estTicks: 9,
      }],
      workTicks: 0,
      estTotalTicks: 9,
    };
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10;
    employee.fatigue = 1;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

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

  // #1013: mirrors the legacy forceShiftRestIfNeeded test above — the
  // policy-aware variant shares finishForceRest's tail, so it needs the same
  // beginRestWalk wiring for its own walk to report actionType: 'rest'.
  it('#1013: reports actionType "rest" via computeEmployeeActivity while walking to the living_quarters', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 401;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;
    placeBuilding(state.buildings, 'living_quarters', 30, 30, 100, 100, 1);

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    const activity = computeEmployeeActivity(employee, state.vehicles.vehicles);
    expect(activity.kind).toBe('walking');
    expect(activity.actionType).toBe('rest');
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

  // #945, RESTORED as a #1090 follow-up: #1090 briefly deleted this
  // dedicated vehicle-gated mid-execution guard on the reasoning that
  // nothing dismounts on completion any more, so an interrupted
  // vehicle-gated task costs no walk-back-and-reboard. That reasoning holds
  // for the mechanism's original cost, but mount continuity through rest
  // (#1118) introduces a different cost the guard also happened to prevent:
  // every interruption re-approaches with the SAME vehicle over the SAME
  // (possibly long) round trip to the rest building, and an interrupted
  // mid-execution task re-arms with a fresh, equally short budget every
  // time — for a site whose living_quarters is far enough that the round
  // trip alone re-crosses the policy's threshold, no segment ever finishes.
  // Confirmed live via needs.integration.test.ts's own #945 box-cut suite
  // and the tutorial-boxcut-full scenario, both livelocking forever once
  // this guard was gone. See forceShiftRestIfNeededByPolicy's own inline
  // comment and isMidVehicleGatedWork's own doc comment (VehicleReservation.ts).
  it('#945: no-op when boarded and mid-execution of a vehicle-gated action (taskTicksRemaining set), even with fatigue deep below threshold', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const prior = pushHeldAction(state, employee.id, 1100);
    prior.requiredVehicleRole = 'rock_digger';
    vehicle.occupantIds = [employee.id];
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
    vehicle.occupantIds = [employee.id];
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

  // NEW (#1039, widened by #1049): an action mid-execution (taskTicksRemaining
  // set, employee arrived and actively working) must NOT be interrupted by a
  // proactive shift-cycle/fatigue-threshold rest — unlike the general_work
  // case above (#945 follow-up), which stays interruptible.
  // isMidConstructionWork/PROTECTED_MID_EXECUTION_ACTION_TYPES scopes this
  // guard to place_building, charge_hole and survey specifically, mirroring
  // isMidVehicleGatedWork's own scoping for vehicle-gated work — each shares
  // the same fragmentation bug class (a single task fragmented into many
  // interrupted, restarted attempts).
  it.each<[ActionType, number]>([
    ['place_building', 1103],
    ['charge_hole', 1106],
    ['survey', 1107],
  ])('#1039/#1049: no-op when mid-execution of a %s action (taskTicksRemaining set), even with fatigue very low', (actionType, id) => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const prior = pushHeldAction(state, employee.id, id, actionType);
    employee.activeActionId = prior.id;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10;
    employee.fatigue = 1;
    employee.taskTicksRemaining = 3;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.activeActionId).toBe(id);
    const held = state.pendingActions.find(a => a.id === id)!;
    expect(held.status).toBe('in_progress');
  });

  // #1039: general_work is unaffected by the new place_building guard — see
  // the pre-existing #945 follow-up test above, which already pins this.

  // NEW (#1039): the new place_building guard is scoped to the executing
  // phase only (taskTicksRemaining !== null) — mirrors isMidVehicleGatedWork's
  // own drive-vs-execute distinction (see the mid-drive test above). A
  // place_building action still mid-walk to the site (pendingTaskDuration set,
  // taskTicksRemaining still null — not yet arrived) stays interruptible.
  // Ordinarily an unfinished walk is already unconditionally protected by
  // this function's own earlier `pendingTaskDuration !== null && !isMoveStuck`
  // guard (line above shouldForceRest) regardless of action type, so
  // `isMoveStuck: true` is set here to take that earlier, unrelated guard out
  // of play — isolating what the new place_building guard alone decides once
  // taskTicksRemaining is still null (not yet arrived): it must not block.
  it('#1039: STILL interrupts a place_building action mid-walk (pendingTaskDuration set, taskTicksRemaining still null — not yet arrived)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const prior = pushHeldAction(state, employee.id, 1105, 'place_building');
    prior.status = 'assigned';
    employee.activeActionId = prior.id;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10;
    employee.fatigue = 1;
    employee.pendingTaskDuration = 5;
    employee.taskTicksRemaining = null;
    employee.isMoveStuck = true;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestDuration).not.toBeNull();
    expect(employee.activeActionId).not.toBe(1105);
  });

  // #1118: mirrors the legacy forceShiftRestIfNeeded's own #1118 test above —
  // the policy-aware variant shares finishForceRest's tail, so a mounted
  // employee forced into a policy rest stays mounted too.
  it('#1118: a mounted employee forced into a policy rest stays mounted, with a drive-leg itinerary installed toward the rest target, no forced alight', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const prior = pushHeldAction(state, employee.id, 1131);
    employee.activeActionId = prior.id;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(employee.itinerary).not.toBeNull();
    const driveLeg = employee.itinerary!.legs.find(l => l.mode === 'drive');
    expect(driveLeg).toBeDefined();
    expect(driveLeg!.vehicleId).toBe(vehicle.id);
  });
});

// #1091: isMidLoadedHaul moved into ForceShiftRest.ts itself as a private
// helper (checks vehicle.payload !== null instead of the deleted
// haulingPhase === 'to_depot') — no longer exported from
// FragmentTaskLifecycle.ts, so it has no dedicated direct-call unit test any
// more; its behavior is covered indirectly through
// forceShiftRestIfNeededByPolicy below, same as the #974 header comment
// already noted was true even for the old exported version.
describe('forceShiftRestIfNeededByPolicy protects a loaded haul leg via isMidLoadedHaul (#974, #1091)', () => {
  it('no-op when the employee is driving a vehicle mid loaded haul leg (payload set), even with fatigue deep below threshold', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    Object.assign(state.sitePolicy, { shiftMode: 'shift_8h' });
    state.sitePolicy.revision = (state.sitePolicy.revision ?? 0) + 1;
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    vehicle.occupantIds = [employee.id];
    vehicle.payload = { fragmentId: 1, massKg: 500 };
    const prior = pushHeldAction(state, employee.id, 1200);
    prior.requiredVehicleRole = 'debris_hauler';
    employee.activeActionId = prior.id;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10;
    employee.fatigue = 1;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.activeActionId).toBe(1200);
  });

  it('DOES interrupt when the vehicle is not yet loaded (payload null) — this leg is deliberately unprotected', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    Object.assign(state.sitePolicy, { shiftMode: 'shift_8h' });
    state.sitePolicy.revision = (state.sitePolicy.revision ?? 0) + 1;
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    vehicle.occupantIds = [employee.id];
    vehicle.payload = null;
    const prior = pushHeldAction(state, employee.id, 1201);
    prior.requiredVehicleRole = 'debris_hauler';
    employee.activeActionId = prior.id;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h * 10;
    employee.fatigue = 1;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(employee.pendingRestDuration).not.toBeNull();
    expect(employee.activeActionId).not.toBe(1201);
  });
});

// #1110: the shift-rest interruption path leaked a vehicle reservation held
// by an action still sitting unboarded in the interrupted employee's
// taskQueue — the same leak #1096 (fixed in #1107) closed for tickCollapse's
// `collapsing` employees, via releaseUnboardedTaskQueueVehicleReservations
// (EmployeeDispatchSteps.ts). Neither forceShiftRestIfNeeded nor
// forceShiftRestIfNeededByPolicy ever set `collapsing`, so none of #1107's
// release calls fire on this path — finishForceRest (the shared tail both
// call) must call it directly.
describe('#1110: releases a taskQueue-held vehicle reservation on shift-rest interruption', () => {
  /** Apply a policy the way set_policy does: bump revision, set shiftMode/thresholds. */
  function applyPolicy(state: GameState, overrides: Partial<ReturnType<typeof createSitePolicy>> = {}): void {
    Object.assign(state.sitePolicy, overrides);
    state.sitePolicy.revision = (state.sitePolicy.revision ?? 0) + 1;
  }

  /** A queued, vehicle-gated action sitting in `employee.taskQueue`, unboarded. */
  function pushQueuedGatedAction(state: GameState, employeeId: number, id: number): PendingAction {
    const action: PendingAction = {
      id, type: 'drill_hole', requiredSkill: null, requiredVehicleRole: 'drill_rig',
      targetX: 5, targetZ: 5, targetY: 0, payload: {},
      targetEmployeeId: null, status: 'assigned', holderId: employeeId,
      queuedAtTick: 0,
    };
    state.pendingActions.push(action);
    return action;
  }

  it('forceShiftRestIfNeeded releases an unboarded, vehicle-gated taskQueue reservation when it forces a rest', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const prior = pushHeldAction(state, employee.id, 1110);
    employee.activeActionId = prior.id;
    employee.ticksWorked = WORK_DURATION_TICKS;

    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    const gatedAction = pushQueuedGatedAction(state, employee.id, 1111);
    employee.taskQueue = [gatedAction.id];
    vehicle.reservedForActionId = gatedAction.id;
    // vehicle.driverId stays null — reserved but never boarded.

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(vehicle.reservedForActionId).toBeNull();
    expect(gatedAction.status).toBe('queued');
    expect(gatedAction.holderId).toBeNull();
    expect(employee.taskQueue).not.toContain(gatedAction.id);
  });

  it('forceShiftRestIfNeededByPolicy releases an unboarded, vehicle-gated taskQueue reservation when it forces a rest', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    applyPolicy(state, { shiftMode: 'shift_8h' });
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const prior = pushHeldAction(state, employee.id, 1112);
    employee.activeActionId = prior.id;
    employee.ticksWorked = SHIFT_DURATIONS_TICKS.shift_8h;

    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    const gatedAction = pushQueuedGatedAction(state, employee.id, 1113);
    employee.taskQueue = [gatedAction.id];
    vehicle.reservedForActionId = gatedAction.id;

    forceShiftRestIfNeededByPolicy(state, employee, [], []);

    expect(vehicle.reservedForActionId).toBeNull();
    expect(gatedAction.status).toBe('queued');
    expect(gatedAction.holderId).toBeNull();
    expect(employee.taskQueue).not.toContain(gatedAction.id);
  });

  it('forceShiftRestIfNeeded: the active action (already released by interruptActiveAction) is unaffected by the new call — no double-release, no crash with an empty taskQueue', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    const activeAction: PendingAction = {
      id: 1114, type: 'drill_hole', requiredSkill: null, requiredVehicleRole: 'drill_rig',
      targetX: 5, targetZ: 5, targetY: 0, payload: {},
      targetEmployeeId: null, status: 'in_progress', holderId: employee.id,
      queuedAtTick: 0,
    };
    state.pendingActions.push(activeAction);
    employee.activeActionId = activeAction.id;
    employee.ticksWorked = WORK_DURATION_TICKS;
    employee.taskQueue = []; // nothing queued — only the active action exists
    vehicle.occupantIds = [employee.id];
    vehicle.reservedForActionId = activeAction.id;

    expect(() => forceShiftRestIfNeeded(state, employee, [], [])).not.toThrow();

    // interruptActiveAction (existing, pre-#1110 behavior) released the
    // active action and its vehicle reservation on its own — the new
    // taskQueue-release logic must not interfere with or duplicate that, and
    // must not crash on an empty taskQueue.
    const released = state.pendingActions.find(a => a.id === activeAction.id)!;
    expect(released.status).toBe('queued');
    expect(released.holderId).toBeNull();
    expect(employee.activeActionId).not.toBe(activeAction.id);
    expect(vehicle.reservedForActionId).toBeNull();
    expect(employee.taskQueue).toEqual([]);
  });

  it('leaves a boarded vehicle (driverId already set) for a taskQueue action untouched — releaseUnboardedTaskQueueVehicleReservations\' own guard still holds through this new call site', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const otherEmployee = hireEmployee(state.employees, 'driller', rng, 10, 10).employee;

    const prior = pushHeldAction(state, employee.id, 1115);
    employee.activeActionId = prior.id;
    employee.ticksWorked = WORK_DURATION_TICKS;

    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    const gatedAction = pushQueuedGatedAction(state, employee.id, 1116);
    employee.taskQueue = [gatedAction.id];
    vehicle.reservedForActionId = gatedAction.id;
    vehicle.occupantIds = [otherEmployee.id]; // already boarded by someone else

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(vehicle.reservedForActionId).toBe(gatedAction.id);
    expect(vehicleDriverId(vehicle)).toBe(otherEmployee.id);
    expect(gatedAction.status).toBe('assigned');
    expect(gatedAction.holderId).toBe(employee.id);
    expect(employee.taskQueue).toContain(gatedAction.id);
  });

  it('a second shift-rest interruption on the same employee/queue later in the run does not leak either', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    // First interruption.
    const prior1 = pushHeldAction(state, employee.id, 1117);
    employee.activeActionId = prior1.id;
    employee.ticksWorked = WORK_DURATION_TICKS;

    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    const gatedAction1 = pushQueuedGatedAction(state, employee.id, 1118);
    employee.taskQueue = [gatedAction1.id];
    vehicle.reservedForActionId = gatedAction1.id;

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(vehicle.reservedForActionId).toBeNull();
    expect(employee.taskQueue).not.toContain(gatedAction1.id);

    // Rest completes; employee resumes work, re-claims a (new) vehicle-gated
    // action into the taskQueue, and works long enough to cross
    // WORK_DURATION_TICKS a second time.
    employee.restTicksRemaining = null;
    employee.pendingRestDuration = null;
    employee.pendingTaskDuration = null;
    employee.taskTicksRemaining = null;

    const prior2 = pushHeldAction(state, employee.id, 1119);
    employee.activeActionId = prior2.id;
    employee.ticksWorked = WORK_DURATION_TICKS;

    const gatedAction2 = pushQueuedGatedAction(state, employee.id, 1120);
    employee.taskQueue = [gatedAction2.id];
    vehicle.reservedForActionId = gatedAction2.id;
    // vehicle.driverId stays null — reserved but never boarded, again.

    forceShiftRestIfNeeded(state, employee, [], []);

    expect(vehicle.reservedForActionId).toBeNull();
    expect(gatedAction2.status).toBe('queued');
    expect(gatedAction2.holderId).toBeNull();
    expect(employee.taskQueue).not.toContain(gatedAction2.id);
  });
});
