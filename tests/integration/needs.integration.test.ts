// BlastSimulator2026 — Integration tests: Employee needs system (Phase 6)
// Covers hunger/fatigue/breakNeed gauges, morale effects, collapse, and building replenishment.
// Defines 10 real tests against the core EmployeeNeeds API and the needs console command.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { employeeCommand, needsCommand, buildCommand } from '../../src/console/commands/entities.js';
import { tickCommand, eventCommand } from '../../src/console/commands/events.js';
import { setPolicyCommand } from '../../src/console/commands/policy.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';

import {
  tickNeedGauges,
  needsMoraleEffect,
  replenishNeed,
  checkCollapse,
  getNeedMultiplier,
} from '../../src/core/entities/EmployeeNeeds.js';
import type { Employee } from '../../src/core/entities/Employee.js';
import {
  NEED_WARNING_THRESHOLDS,
  NEED_REST_DURATIONS,
  NEED_COLLAPSE_THRESHOLDS,
  AGENT_WALK_SPEED,
  NEED_DRAIN_RATES,
} from '../../src/core/config/balance.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build a fresh context with a real GameState (seed=42, desert biome). */
function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

/** Hire one employee and return their numeric ID (always 1 on a fresh state). */
function hireOne(ctx: GameContext, role = 'blaster'): number {
  const result = employeeCommand(ctx, ['hire'], { role });
  if (!result.success) throw new Error(`Setup: hire failed — ${result.output}`);
  return ctx.state!.employees.employees[0]!.id;
}

/** Get the employee object from the game state. */
function getEmployee(ctx: GameContext, id: number): Employee {
  const emp = ctx.state!.employees.employees.find(e => e.id === id);
  if (!emp) throw new Error(`Employee #${id} not found`);
  return emp;
}

// ── Employee needs ───────────────────────────────────────────────────────────

describe('Employee needs', () => {
  let ctx: GameContext;
  let empId: number;

  beforeEach(() => {
    ctx = makeCtx();
    empId = hireOne(ctx);
  });

  // ── 1. tickNeedGauges drains gauges when working ─────────────────────────

  it('tickNeedGauges drains gauges when working', () => {
    const emp = getEmployee(ctx, empId);
    // Default morale is 60 → drain multiplier is 1.0 (normal range)
    expect(emp.morale).toBe(60);

    // Set all gauges to 100
    emp.hunger = 100;
    emp.fatigue = 100;
    emp.breakNeed = 100;

    tickNeedGauges(emp, 'working');

    // working drain rates at 1×: hunger=1, fatigue=2, breakNeed=0.8
    expect(emp.hunger).toBe(99);
    expect(emp.fatigue).toBe(98);
    expect(emp.breakNeed).toBeCloseTo(99.2, 1);
  });

  // ── 2. tickNeedGauges drains slower when idle ────────────────────────────

  it('tickNeedGauges drains slower when idle', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 100;
    emp.fatigue = 100;
    emp.breakNeed = 100;

    // Record values after one working tick
    tickNeedGauges(emp, 'working');
    const workingHunger = emp.hunger;
    const workingFatigue = emp.fatigue;
    const workingBreak = emp.breakNeed;

    // Reset and do one idle tick
    emp.hunger = 100;
    emp.fatigue = 100;
    emp.breakNeed = 100;
    tickNeedGauges(emp, 'idle');

    // idle drain rates at 1×: hunger=0.5, fatigue=0.5, breakNeed=0
    // Hunger and fatigue drain less when idle
    expect(emp.hunger).toBeGreaterThan(workingHunger);
    expect(emp.fatigue).toBeGreaterThan(workingFatigue);
    // breakNeed does not drain when idle
    expect(emp.breakNeed).toBe(100);
  });

  // ── 3. Gauges clamped to minimum 0 ───────────────────────────────────────

  it('gauges clamped to minimum 0', () => {
    const emp = getEmployee(ctx, empId);
    // Set hunger to a value that would go negative in one working tick
    emp.hunger = 0.5;

    tickNeedGauges(emp, 'working');

    expect(emp.hunger).toBe(0);
    // Ensure it never went negative
    expect(emp.hunger).toBeGreaterThanOrEqual(0);
  });

  // ── 4. needsMoraleEffect returns negative delta when needs low ───────────

  it('needsMoraleEffect returns negative delta when needs low', () => {
    const emp = getEmployee(ctx, empId);
    // All three gauges below suffering threshold (15) = critical tier
    // Each gauge contributes -3.0 → total delta = -9.0
    emp.hunger = 10;
    emp.fatigue = 10;
    emp.breakNeed = 10;

    const delta = needsMoraleEffect(emp);

    expect(delta).toBeLessThan(0);
    expect(delta).toBe(-9);
  });

  // ── 5. checkCollapse sets collapsing and clears action ─────────────────────

  it('checkCollapse sets collapsing and clears action', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 100;
    emp.fatigue = 100;
    emp.breakNeed = 100;
    emp.activeActionId = 42;
    emp.collapsing = false;

    // Set hunger at or below collapse threshold (hunger ≤ 10)
    emp.hunger = 10;

    const result = checkCollapse(emp);

    expect(result).toBe('hunger');
    expect(emp.collapsing).toBe(true);
    expect(emp.activeActionId).toBeNull();
  });

  // ── 6. replenishNeed restores gauge value ─────────────────────────────────

  it('replenishNeed restores gauge value', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 50;

    // Tier-1 building with capacity: replenish rate = 12/tick
    const success = replenishNeed(emp, 'hunger', 1, 100);

    expect(success).toBe(true);
    expect(emp.hunger).toBe(62);
  });

  // ── 7. replenishNeed with zero capacity returns false ─────────────────────

  it('replenishNeed with zero capacity returns false', () => {
    const emp = getEmployee(ctx, empId);
    emp.fatigue = 50;
    const fatigueBefore = emp.fatigue;

    const success = replenishNeed(emp, 'fatigue', 1, 0);

    expect(success).toBe(false);
    expect(emp.fatigue).toBe(fatigueBefore);
  });

  // ── 8. checkCollapse returns null if already collapsing ───────────────────

  it('checkCollapse returns null if already collapsing', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 5; // Below collapse threshold, would normally trigger collapse
    emp.collapsing = true;

    const result = checkCollapse(emp);

    expect(result).toBeNull();
    // collapsing flag should remain true (not reset)
    expect(emp.collapsing).toBe(true);
  });

  // ── 9. needs command shows gauges for employees ──────────────────────────

  it('needs command shows gauges for employees', () => {
    const result = needsCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('Employee Needs');
    expect(result.output).toContain('hunger:');
    expect(result.output).toContain('fatigue:');
    expect(result.output).toContain('break:');
    expect(result.output).toContain(`[${empId}]`);
  });

  // ── 10. needs command handles no employees ───────────────────────────────

  it('needs command handles no employees', () => {
    // Create a fresh context with no employees
    const emptyCtx = makeCtx();

    const result = needsCommand(emptyCtx, [], {});

    expect(result.success).toBe(true);
    expect(result.output).toBe('No employees.');
  });

  // ── Bonus: needsMoraleEffect with well-rested bonus ──────────────────────

  it('needsMoraleEffect returns positive delta when all gauges well-rested', () => {
    const emp = getEmployee(ctx, empId);
    // All three gauges above 80 → well-rested bonus of +1
    emp.hunger = 85;
    emp.fatigue = 85;
    emp.breakNeed = 85;

    const delta = needsMoraleEffect(emp);

    // well-rested bonus (+1) + comfortable (0 × 3) = +1
    expect(delta).toBe(1);
  });

  // ── Bonus: getNeedMultiplier returns 1.0 when gauges high ─────────────────

  it('getNeedMultiplier returns 1.0 when all gauges are above thresholds', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 100;
    emp.fatigue = 100;

    const mult = getNeedMultiplier(emp);

    expect(mult).toBe(1.0);
  });

  // ── Bonus: getNeedMultiplier penalty when hunger is critically low ────────

  it('getNeedMultiplier returns a penalty when hunger is critically low', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 5;  // below critical (10)
    emp.fatigue = 100; // no fatigue penalty

    const mult = getNeedMultiplier(emp);

    // hunger critical → 0.60, fatigue none → 1.0
    expect(mult).toBeCloseTo(0.60, 2);
  });

  // ── Bonus: getNeedMultiplier penalty when fatigue is critically low ───────

  it('getNeedMultiplier returns a penalty when fatigue is critically low', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 100;  // no hunger penalty
    emp.fatigue = 10;   // below critical (15)

    const mult = getNeedMultiplier(emp);

    // fatigue critical → 0.50, hunger none → 1.0
    expect(mult).toBeCloseTo(0.50, 2);
  });
});

// ── tick command — resting employee drains at the 'resting' tier, not idle ───
//
// #680: the original fix (isWorking now also requires restTicksRemaining ===
// null) only got a resting employee OUT of the working-rate bucket — it fell
// into the idle bucket instead, at NEED_DRAIN_RATES.*.idle, which still
// drains hunger/fatigue. That undermines rest's own completion-time
// replenishment lump sum: an employee resting for many ticks keeps leaking
// gauges the whole time. The full fix adds a third 'resting' tier
// (employeeWorkState classifies restTicksRemaining !== null as 'resting') at
// drain rate 0 — gauges hold steady during active rest.

describe('tick command — resting employees drain at the resting tier (rate 0), not idle', () => {
  let ctx: GameContext;
  let empId: number;

  beforeEach(() => {
    ctx = makeCtx();
    empId = hireOne(ctx);
  });

  it('drains a resting employee at the resting-tier rate (0) during tick, not the idle rate', () => {
    const emp = getEmployee(ctx, empId);
    // Simulate mid-rest: claimed by a rest action, timer running.
    emp.activeActionId = 999;
    emp.restTicksRemaining = 10;
    emp.restNeedKey = null; // not owned by tickGeneralRestCompletion or processShiftCycle
    emp.hunger = 100;
    emp.breakNeed = 100;

    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(true);
    // resting tier: hunger does not drain at all (0/tick — not 0.5 idle, not 1 working)
    expect(emp.hunger).toBe(100);
    // resting tier: breakNeed does not drain at all either (0, same as idle here, but for the resting reason)
    expect(emp.breakNeed).toBe(100);
    // Rest state itself is untouched by the needs-drain step.
    expect(emp.restTicksRemaining).toBe(10);
    expect(emp.activeActionId).toBe(999);
  });
});

// ── #680 regression: travel-toward-rest misclassified as 'working' ──────────
//
// Root cause under test: before the fix, isWorking = activeActionId !== null
// && restTicksRemaining === null. An employee routed to rest but still
// walking there (activeActionId set to the rest action, pendingRestDuration
// !== null, restTicksRemaining still null because they haven't arrived) has
// activeActionId !== null and restTicksRemaining === null — so the old check
// misclassified them as WORKING and drained them at the working rate while
// they were merely walking. The fix's employeeWorkState() must classify this
// exact state as 'idle' (pendingRestDuration !== null excludes it from
// 'working'), not 'resting' (that requires restTicksRemaining !== null) and
// not 'working'.

describe('#680 regression — an employee walking toward rest drains at the idle rate, not working', () => {
  it('drains hunger/fatigue at the idle rate (not working) while travelling to a distant living_quarters', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    const empId = hireOne(ctx, 'driller');
    const emp = getEmployee(ctx, empId);

    // Same distance/tick budget as the "does not decrement restTicksRemaining
    // while the employee is still travelling" test above (proven safe: a few
    // ticks in, the employee is still mid-walk, not yet at (20,20)).
    state.cash = 100_000;
    const build = buildCommand(ctx, ['living_quarters'], { at: '20,20', tier: '1' });
    expect(build.success).toBe(true);

    emp.x = 0;
    emp.z = 0;
    emp.hunger = 20; // below warning threshold — triggers routing toward rest
    emp.fatigue = 100;
    emp.breakNeed = 100;

    // First tick: routed toward the living_quarters, but not arrived yet.
    tickCommand(ctx, ['1'], {});
    expect(emp.destinationX).not.toBeNull();
    expect(emp.destinationZ).not.toBeNull();
    expect(emp.activeActionId).not.toBeNull();
    // Still travelling: rest has not started (restTicksRemaining stays null
    // until ArrivalGate promotes pendingRestDuration on arrival).
    expect(emp.restTicksRemaining).toBeNull();

    const fatigueAfterFirstTick = emp.fatigue;

    // A few more ticks — still travelling (distance from (0,0) to (20,20) is
    // well beyond a few ticks at AGENT_WALK_SPEED), rest still has not started.
    const TRAVEL_SAMPLE_TICKS = 3;
    for (let i = 0; i < TRAVEL_SAMPLE_TICKS; i++) tickCommand(ctx, ['1'], {});

    // Confirms the test's own distance/tick budget is sized correctly,
    // independent of the drain-rate bug under test.
    expect(emp.x === 20 && emp.z === 20).toBe(false); // still travelling
    expect(emp.restTicksRemaining).toBeNull(); // rest has not started

    // The bug: fatigue (working rate 2/tick) drains far faster than the idle
    // rate (0.5/tick) predicts, because activeActionId is set (the rest
    // action) and restTicksRemaining is still null — the old isWorking check
    // misclassified this as WORKING. Assert a band, not just an upper bound,
    // so this test is RED against both failure modes: a no-op/unimplemented
    // tickNeedGauges (drain = 0, fails the lower bound) and the pre-fix
    // working-rate misclassification (drain ≈ 2/tick × 3 = 6, fails the upper
    // bound). Only the idle rate (0.5/tick × 3 = 1.5, ±headroom for the
    // morale multiplier) lands inside the band.
    const fatigueDrainedDuringTravel = fatigueAfterFirstTick - emp.fatigue;
    const idleRateLowerBound = NEED_DRAIN_RATES.fatigue.idle * TRAVEL_SAMPLE_TICKS * 0.5; // well below even a low-morale idle drain
    const idleRateUpperBound = NEED_DRAIN_RATES.fatigue.idle * TRAVEL_SAMPLE_TICKS * 1.2; // 1.2 = low-morale multiplier headroom, still « working rate
    expect(fatigueDrainedDuringTravel).toBeGreaterThan(idleRateLowerBound);
    expect(fatigueDrainedDuringTravel).toBeLessThanOrEqual(idleRateUpperBound);
  });
});

// ── tick command — one dip below the warning threshold costs exactly one rest ─
//
// End-to-end guard for the duplicate-rest insertion: while an employee is
// mid-rest the gauge is still below its warning threshold and the claimed rest
// action is no longer in pendingActions, so autoInsertNeedTasks used to queue a
// second rest that was claimed the moment the first completed — two
// NEED_REST_COSTS charges and two rest cycles for a single dip.

describe('tick command — a single threshold dip triggers a single rest', () => {
  it('charges NEED_REST_COSTS.hunger once and restores the gauge once', () => {
    const ctx = makeCtx();
    const empId = hireOne(ctx, 'driller');
    const state = ctx.state!;
    const emp = getEmployee(ctx, empId);

    const build = buildCommand(ctx, ['living_quarters'], { at: '5,5', tier: '1' });
    expect(build.success).toBe(true);

    state.cash = 100_000;
    emp.x = 0;
    emp.z = 0;
    emp.hunger = 34; // just below the 35 warning threshold
    emp.fatigue = 100;
    emp.breakNeed = 100;

    // The employee is routed toward the living_quarters on the very first
    // tick, but (issue #437) the rest timer must not start until they have
    // actually walked there — routing alone is not resolution.
    tickCommand(ctx, ['1'], {});
    expect(emp.destinationX).not.toBeNull();
    expect(emp.destinationZ).not.toBeNull();
    expect(emp.restTicksRemaining).toBeNull();

    // Long enough for the walk to (5,5) plus the full rest duration, with slack,
    // but short of the ~14-tick idle hunger decay (NEED_DRAIN_RATES.hunger.idle)
    // that would otherwise dip the gauge below the warning threshold a second
    // time and start an unrelated second rest cycle — this test is only about
    // the first, deliberately-triggered dip.
    for (let i = 0; i < 12; i++) tickCommand(ctx, ['1'], {});

    const restCharges = state.finances.transactions.filter(t => t.category === 'needs');
    expect(restCharges).toHaveLength(1);
    expect(emp.restTicksRemaining).toBeNull();
    expect(emp.restNeedKey).toBeNull();
    expect(emp.activeActionId).toBeNull();
    expect(emp.hunger).toBeGreaterThan(NEED_WARNING_THRESHOLDS.hunger);
    expect(state.pendingActions.filter(a => a.type === 'rest')).toHaveLength(0);
  });

  // ── New (issue #437): rest must not tick down while still travelling ──────

  it('does not decrement restTicksRemaining while the employee is still travelling to the living_quarters', () => {
    const ctx = makeCtx();
    const empId = hireOne(ctx, 'driller');
    const state = ctx.state!;
    const emp = getEmployee(ctx, empId);

    const build = buildCommand(ctx, ['living_quarters'], { at: '20,20', tier: '1' });
    expect(build.success).toBe(true);

    state.cash = 100_000;
    emp.x = 0;
    emp.z = 0;
    emp.hunger = 20; // below warning threshold — triggers routing
    emp.fatigue = 100;
    emp.breakNeed = 100;

    tickCommand(ctx, ['1'], {});

    // Routed but not yet arrived: destination set, rest not started.
    expect(emp.destinationX).not.toBeNull();
    expect(emp.destinationZ).not.toBeNull();
    expect(emp.restTicksRemaining).toBeNull();

    // A few more ticks — still travelling (distance from (0,0) to the
    // building is well beyond a few ticks at AGENT_WALK_SPEED), rest still
    // has not started.
    for (let i = 0; i < 3; i++) tickCommand(ctx, ['1'], {});
    expect(emp.x === 20 && emp.z === 20).toBe(false);
    expect(emp.restTicksRemaining).toBeNull();

    // Enough ticks to arrive (distance (0,0)→(20,20) ≈ 28.3 cells / AGENT_WALK_SPEED)
    // and finish the rest (NEED_REST_DURATIONS.hunger ticks of work once
    // arrival gates the timer open), with slack.
    const travelTicks = Math.ceil(Math.hypot(20, 20) / AGENT_WALK_SPEED);
    for (let i = 0; i < travelTicks + NEED_REST_DURATIONS.hunger + 10; i++) tickCommand(ctx, ['1'], {});

    expect(emp.restTicksRemaining).toBeNull(); // completed and cleared
    expect(emp.hunger).toBeGreaterThan(NEED_WARNING_THRESHOLDS.hunger);
  });
});

// ── #678: forced rest under an applied SitePolicy, driven end to end ────────
//
// SitePolicy.shouldForceRest used to be dead code — applying a policy via
// set_policy changed state.sitePolicy but nothing ever consulted it during a
// tick. These two tests drive a solo employee kept continuously busy (via
// `employee dispatch`, re-issued the moment they go genuinely idle — never
// while mid-walk or resting) across a multi-hundred-tick stretch, once with
// a policy applied and once without, to prove the opt-in gate for real: an
// applied policy keeps the hunger/fatigue gauges themselves off the floor;
// without one, only the pre-existing (unrelated, unchanged by #678) collapse
// safety net protects the employee, and it lets the run reach collapse
// territory that an applied policy's tighter thresholds never approach.
//
// scores.wellBeing tracks avgMorale (ScoreManager.updateScores), and morale
// is driven by needsMoraleEffect (EmployeeNeeds.ts), which penalizes any
// gauge below its own "comfortable" threshold of 50. SITE_POLICY_DEFAULT_
// THRESHOLDS (src/core/config/balance.ts) now sit at hunger:60/fatigue:60 —
// at or above that comfortable band — so a policy-protected employee no
// longer spends the run in morale's penalty zone, and wellBeing stays off
// the floor alongside hunger/fatigue.

describe('forced rest under an applied SitePolicy — driven through the console (#678)', () => {
  /**
   * Keep `empId` continuously working at their own position (no walking
   * time wasted) for `ticks` real console ticks: re-dispatch only when
   * genuinely idle (never mid-walk to a rest, never resting, never in
   * training) so any forced rest — collapse-driven or policy-driven — is
   * free to claim them instead of being starved out by a greedy redispatch.
   * Resolves pending events and un-pauses exactly like tickWithEvents in
   * tests/integration/full-level/helpers.ts.
   */
  function driveContinuousWork(
    ctx: GameContext,
    empId: number,
    ticks: number,
    onTick: (emp: Employee) => void,
  ): void {
    const state = ctx.state!;
    for (let i = 0; i < ticks; i++) {
      const emp = getEmployee(ctx, empId);
      if (
        emp.alive && !emp.injured && emp.trainingState === null &&
        emp.activeActionId === null && emp.restTicksRemaining === null && emp.pendingRestDuration === null
      ) {
        employeeCommand(ctx, ['dispatch', String(empId)], { x: String(emp.x), z: String(emp.z) });
      }

      tickCommand(ctx, ['1'], {});
      if (state.events.pendingEvent) eventCommand(ctx, ['choose', '0'], {});
      if (state.isPaused) state.isPaused = false;

      onTick(getEmployee(ctx, empId));
    }
  }

  const RUN_TICKS = 300;

  it('keeps hunger, fatigue, and scores.wellBeing above 0 across a long run when a policy is applied', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    state.cash = 1_000_000;
    const empId = hireOne(ctx, 'driller');

    const build = buildCommand(ctx, ['living_quarters'], { at: '0,0', tier: '1' });
    expect(build.success).toBe(true);

    const policyResult = setPolicyCommand(ctx, [], { mode: 'shift_8h' });
    expect(policyResult.success).toBe(true);
    expect(state.sitePolicy.revision).toBeGreaterThan(0);

    let sawForcedRestTransition = false;
    ctx.emitter.on('employee:shift_change', () => { sawForcedRestTransition = true; });

    let minHunger = 100;
    let minFatigue = 100;
    let minWellBeing = 100;

    driveContinuousWork(ctx, empId, RUN_TICKS, (emp) => {
      minHunger = Math.min(minHunger, emp.hunger);
      minFatigue = Math.min(minFatigue, emp.fatigue);
      minWellBeing = Math.min(minWellBeing, state.scores.wellBeing);
    });

    expect(sawForcedRestTransition).toBe(true);
    expect(minHunger).toBeGreaterThan(0);
    expect(minFatigue).toBeGreaterThan(0);
    expect(minWellBeing).toBeGreaterThan(0);
  });

  it('WITHOUT a policy applied, the same run reaches collapse territory (opt-in contrast case)', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    state.cash = 1_000_000;
    const empId = hireOne(ctx, 'driller');

    const build = buildCommand(ctx, ['living_quarters'], { at: '0,0', tier: '1' });
    expect(build.success).toBe(true);

    // No set_policy call — revision stays 0, the opt-in gate stays closed.
    expect(state.sitePolicy.revision).toBe(0);

    let sawCollapse = false;
    let minHunger = 100;
    let minFatigue = 100;

    driveContinuousWork(ctx, empId, RUN_TICKS, (emp) => {
      sawCollapse = sawCollapse || emp.collapsing;
      minHunger = Math.min(minHunger, emp.hunger);
      minFatigue = Math.min(minFatigue, emp.fatigue);
    });

    expect(sawCollapse).toBe(true);
    expect(Math.min(minHunger, minFatigue)).toBeLessThanOrEqual(
      Math.max(NEED_COLLAPSE_THRESHOLDS.hunger, NEED_COLLAPSE_THRESHOLDS.fatigue),
    );
  });
});

// ── #680 acceptance test — tri-state needs drain must prevent a false revolt ─
//
// Issue's own named acceptance scenario: a staffed site, a reachable tier-1
// living_quarters, a shift_8h SitePolicy applied, and 400+ continuous ticks
// of real drilling work must never let scores.wellBeing collapse hard enough
// for a permanent worker revolt (`revolt:triggered`, WorkerRevolt.ts) to
// fire. Under the pre-fix code an employee routed toward rest but still
// travelling is drained at the WORKING rate (the misclassification bug), and
// an employee actively resting is drained at the IDLE rate instead of
// holding steady — both erode the gauges faster than the rest cycle can
// replenish them, eventually driving wellBeing to 0 for a sustained
// REVOLT_TICKS stretch even though a protective policy is applied.
//
// The contrast case proves the mechanism itself is untouched: an unhoused,
// unrelieved crew under the identical drive still collapses/revolts — #680
// only fixes the drain-rate misclassification, it does not make the game
// unloseable.

describe('#680 acceptance — a policy-protected, housed crew never revolts across a long continuous-work run', () => {
  /**
   * Keep `empId` continuously working at their own position (no walking
   * time wasted) for `ticks` real console ticks: re-dispatch only when
   * genuinely idle (never mid-walk to a rest, never resting, never in
   * training) so any forced rest — collapse-driven or policy-driven — is
   * free to claim them instead of being starved out by a greedy redispatch.
   * Mirrors the #678 driveContinuousWork helper above.
   */
  function driveContinuousWork(
    ctx: GameContext,
    empId: number,
    ticks: number,
    onTick: (emp: Employee) => void,
  ): void {
    const state = ctx.state!;
    for (let i = 0; i < ticks; i++) {
      const emp = getEmployee(ctx, empId);
      if (
        emp.alive && !emp.injured && emp.trainingState === null &&
        emp.activeActionId === null && emp.restTicksRemaining === null && emp.pendingRestDuration === null
      ) {
        employeeCommand(ctx, ['dispatch', String(empId)], { x: String(emp.x), z: String(emp.z) });
      }

      tickCommand(ctx, ['1'], {});
      if (state.events.pendingEvent) eventCommand(ctx, ['choose', '0'], {});
      if (state.isPaused) state.isPaused = false;

      onTick(getEmployee(ctx, empId));
    }
  }

  const RUN_TICKS = 400;

  it('never fires revolt:triggered, and scores.wellBeing never sits pinned at 0 long enough to end the level, across 400+ ticks with an applied shift_8h policy', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    state.cash = 1_000_000;
    const empId = hireOne(ctx, 'driller');

    const build = buildCommand(ctx, ['living_quarters'], { at: '0,0', tier: '1' });
    expect(build.success).toBe(true);

    const policyResult = setPolicyCommand(ctx, [], { mode: 'shift_8h' });
    expect(policyResult.success).toBe(true);
    expect(state.sitePolicy.revision).toBeGreaterThan(0);

    let revoltFired = false;
    ctx.emitter.on('revolt:triggered', () => { revoltFired = true; });

    let minHunger = 100;
    let minFatigue = 100;
    driveContinuousWork(ctx, empId, RUN_TICKS, (emp) => {
      minHunger = Math.min(minHunger, emp.hunger);
      minFatigue = Math.min(minFatigue, emp.fatigue);
    });

    // Sanity check that the run actually exercised the needs-drain/rest
    // machinery rather than trivially never engaging it — a driller working
    // continuously for 400 ticks must dip its gauges below the starting 100
    // at some point (drained by working, restored by the shift's rest
    // cycles). A frozen tickNeedGauges (needs-drain unimplemented) would
    // leave both gauges pinned at 100 the entire run and fail this.
    expect(minHunger).toBeLessThan(100);
    expect(minFatigue).toBeLessThan(100);

    expect(revoltFired).toBe(false);
    expect(state.levelEndReason).not.toBe('worker_revolt');
  });

  it('CONTRAST: the same drive on an unhoused, unrelieved crew (no living_quarters, no policy) does still collapse/revolt', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    state.cash = 1_000_000;
    const empId = hireOne(ctx, 'driller');

    // Deliberately no living_quarters and no set_policy call — the crew has
    // no rest destination and no policy-driven forced-rest thresholds.
    expect(state.buildings.buildings.some(b => b.type === 'living_quarters')).toBe(false);
    expect(state.sitePolicy.revision).toBe(0);

    let revoltFired = false;
    ctx.emitter.on('revolt:triggered', () => { revoltFired = true; });
    let sawCollapse = false;

    // Generous extra headroom over the acceptance run's own 400 ticks — an
    // unhoused crew has no replenishment building at all, so it may take
    // longer than the housed case to accumulate a sustained wellBeing=0
    // stretch (REVOLT_TICKS) on top of driving morale to 0 in the first place.
    driveContinuousWork(ctx, empId, RUN_TICKS + 400, (emp) => {
      sawCollapse = sawCollapse || emp.collapsing;
    });

    // Either the permanent revolt actually fires, or at minimum the crew
    // repeatedly collapses from unmet needs — the punishing mechanism #680
    // does not remove, it only fixes which rate an employee drains at.
    expect(revoltFired || sawCollapse).toBe(true);
  });
});
