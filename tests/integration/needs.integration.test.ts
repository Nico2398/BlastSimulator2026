// BlastSimulator2026 — Integration tests: Employee needs system (Phase 6)
// Covers the fatigue gauge (#928 — hunger and breakNeed removed), morale
// effects, collapse, and building replenishment.
// Defines real tests against the core EmployeeNeeds API and the needs console command.

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { employeeCommand, needsCommand, buildCommand } from '../../src/console/commands/entities.js';
import { tickCommand, eventCommand } from '../../src/console/commands/events.js';
import { setPolicyCommand } from '../../src/console/commands/policy.js';
import { makeGameContext } from '../helpers/gameContext.js';
import { createGameEngine } from '../../scripts/shared/command-runner.js';
import { runCommand } from '../../src/console/createRunner.js';

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
  return makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
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

/**
 * #556: confirming a `build` order only queues a construction site — a
 * living_quarters used as a rest destination isn't a real building (and
 * routing finds nothing to route to) until an idle employee actually
 * finishes it. Hires a dedicated builder (so the test's own employee-under-
 * test is left untouched) and ticks until every ordered site has landed in
 * state.buildings.buildings, mirroring the equivalent helper in
 * economy.integration.test.ts/blast-oversized-boulders.integration.test.ts.
 */
function buildLivingQuartersAndComplete(ctx: GameContext, at: string, maxTicks = 300): void {
  const hireBuilder = employeeCommand(ctx, ['hire'], { role: 'manager' });
  if (!hireBuilder.success) throw new Error(`Setup: builder hire failed — ${hireBuilder.output}`);

  const build = buildCommand(ctx, ['living_quarters'], { at, tier: '1' });
  if (!build.success) throw new Error(`Setup: living_quarters order failed — ${build.output}`);

  for (let i = 0; i < maxTicks && ctx.state!.plannedBuildings.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
  if (ctx.state!.plannedBuildings.length > 0) {
    throw new Error('Setup: living_quarters construction never completed');
  }
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

    emp.fatigue = 100;

    tickNeedGauges(emp, 'working');

    // working drain rate at 1×: fatigue=2
    expect(emp.fatigue).toBe(98);
  });

  // ── 2. tickNeedGauges drains slower when idle ────────────────────────────

  it('tickNeedGauges drains slower when idle', () => {
    const emp = getEmployee(ctx, empId);
    emp.fatigue = 100;

    // Record value after one working tick
    tickNeedGauges(emp, 'working');
    const workingFatigue = emp.fatigue;

    // Reset and do one idle tick
    emp.fatigue = 100;
    tickNeedGauges(emp, 'idle');

    // idle drain rate at 1×: fatigue=0.5 — drains less than working (2)
    expect(emp.fatigue).toBeGreaterThan(workingFatigue);
  });

  // ── 3. Gauge clamped to minimum 0 ───────────────────────────────────────

  it('gauge clamped to minimum 0', () => {
    const emp = getEmployee(ctx, empId);
    // Set fatigue to a value that would go negative in one working tick
    emp.fatigue = 0.5;

    tickNeedGauges(emp, 'working');

    expect(emp.fatigue).toBe(0);
    // Ensure it never went negative
    expect(emp.fatigue).toBeGreaterThanOrEqual(0);
  });

  // ── 4. needsMoraleEffect returns negative delta when fatigue low ─────────

  it('needsMoraleEffect returns negative delta when fatigue low', () => {
    const emp = getEmployee(ctx, empId);
    // Below suffering threshold (15) = critical tier -> -9.0 (#928 rescale)
    emp.fatigue = 10;

    const delta = needsMoraleEffect(emp);

    expect(delta).toBeLessThan(0);
    expect(delta).toBe(-9);
  });

  // ── 5. checkCollapse sets collapsing and clears action ─────────────────────

  it('checkCollapse sets collapsing and clears action', () => {
    const emp = getEmployee(ctx, empId);
    emp.fatigue = 100;
    emp.activeActionId = 42;
    emp.collapsing = false;

    // Set fatigue at or below collapse threshold (fatigue ≤ 5)
    emp.fatigue = 5;

    const result = checkCollapse(emp);

    expect(result).toBe('fatigue');
    expect(emp.collapsing).toBe(true);
    expect(emp.activeActionId).toBeNull();
  });

  // ── 6. replenishNeed restores gauge value ─────────────────────────────────

  it('replenishNeed restores gauge value', () => {
    const emp = getEmployee(ctx, empId);
    emp.fatigue = 50;

    // Tier-1 building with capacity: replenish rate = 8/tick
    const success = replenishNeed(emp, 'fatigue', 1, 100);

    expect(success).toBe(true);
    expect(emp.fatigue).toBe(58);
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
    emp.fatigue = 3; // Below collapse threshold, would normally trigger collapse
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
    expect(result.output).toContain('fatigue:');
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

  it('needsMoraleEffect returns positive delta when fatigue well-rested', () => {
    const emp = getEmployee(ctx, empId);
    // Above 80 → well-rested bonus of +1
    emp.fatigue = 85;

    const delta = needsMoraleEffect(emp);

    // well-rested bonus (+1) + comfortable (0) = +1
    expect(delta).toBe(1);
  });

  // ── Bonus: getNeedMultiplier returns 1.0 when gauge high ─────────────────

  it('getNeedMultiplier returns 1.0 when fatigue is above threshold', () => {
    const emp = getEmployee(ctx, empId);
    emp.fatigue = 100;

    const mult = getNeedMultiplier(emp);

    expect(mult).toBe(1.0);
  });

  // ── Bonus: getNeedMultiplier penalty when fatigue is critically low ───────

  it('getNeedMultiplier returns a penalty when fatigue is critically low', () => {
    const emp = getEmployee(ctx, empId);
    emp.fatigue = 10;   // below critical (15)

    const mult = getNeedMultiplier(emp);

    // fatigue critical → 0.50
    expect(mult).toBeCloseTo(0.50, 2);
  });
});

// ── tick command — resting employee drains at the 'resting' tier, not idle ───
//
// #680: the original fix (isWorking now also requires restTicksRemaining ===
// null) only got a resting employee OUT of the working-rate bucket — it fell
// into the idle bucket instead, at NEED_DRAIN_RATES.fatigue.idle, which still
// drains fatigue. That undermines rest's own completion-time replenishment
// lump sum: an employee resting for many ticks keeps leaking the gauge the
// whole time. The full fix adds a third 'resting' tier (employeeWorkState
// classifies restTicksRemaining !== null as 'resting') at drain rate 0 —
// the gauge holds steady during active rest.

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
    emp.fatigue = 100;

    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(true);
    // resting tier: fatigue does not drain at all (0/tick — not 0.5 idle, not 1 traveling, not 2 working)
    expect(emp.fatigue).toBe(100);
    // Rest state itself is untouched by the needs-drain step.
    expect(emp.restTicksRemaining).toBe(10);
    expect(emp.activeActionId).toBe(999);
  });
});

// ── #928 (extends #680): travel-toward-rest now bills at its own 'traveling'
// tier, not 'idle' ──────────────────────────────────────────────────────────
//
// Root cause #680 fixed: before that fix, isWorking = activeActionId !== null
// && restTicksRemaining === null. An employee routed to rest but still
// walking there (activeActionId set to the rest action, pendingRestDuration
// !== null, restTicksRemaining still null because they haven't arrived) had
// activeActionId !== null and restTicksRemaining === null — so the old check
// misclassified them as WORKING and drained them at the working rate while
// they were merely walking. #680's own fix reclassified this state as
// 'idle'. #928 goes one step further: employeeWorkState now has a dedicated
// 'traveling' tier (pendingTaskDuration !== null || pendingRestDuration !==
// null) distinct from 'idle' — this walk-to-rest state, and the symmetric
// walk-to-a-claimed-job state, both bill at 'traveling' (1/tick), not idle
// (0.5/tick) and not working (2/tick).

describe('#928 — an employee walking toward rest drains at the traveling rate, not idle or working', () => {
  it('drains fatigue at the traveling rate (not idle, not working) while travelling to a distant living_quarters', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    const empId = hireOne(ctx, 'driller');
    const emp = getEmployee(ctx, empId);

    // Same distance/tick budget as the "does not decrement restTicksRemaining
    // while the employee is still travelling" test above (proven safe: a few
    // ticks in, the employee is still mid-walk, not yet at (20,20)).
    state.cash = 100_000;
    buildLivingQuartersAndComplete(ctx, '20,20');

    emp.x = 0;
    emp.z = 0;
    emp.activeActionId = null;
    emp.destinationX = null;
    emp.destinationZ = null;
    emp.fatigue = 20; // below warning threshold — triggers routing toward rest

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

    // Assert a band, not just an upper bound, so this test is RED against
    // both failure modes: a no-op/unimplemented tickNeedGauges (drain = 0,
    // fails the lower bound) and a working-rate misclassification (drain ≈
    // 2/tick × 3 = 6, fails the upper bound). Only the traveling rate
    // (1/tick × 3 = 3, ±headroom for the morale multiplier) lands inside the
    // band — strictly above the idle-rate band (0.5/tick × 3 = 1.5) this
    // same test asserted pre-#928.
    const fatigueDrainedDuringTravel = fatigueAfterFirstTick - emp.fatigue;
    const travelingRateLowerBound = NEED_DRAIN_RATES.fatigue.traveling * TRAVEL_SAMPLE_TICKS * 0.5; // well below even a low-morale traveling drain
    const travelingRateUpperBound = NEED_DRAIN_RATES.fatigue.traveling * TRAVEL_SAMPLE_TICKS * 1.2; // 1.2 = low-morale multiplier headroom, still « working rate
    expect(fatigueDrainedDuringTravel).toBeGreaterThan(travelingRateLowerBound);
    expect(fatigueDrainedDuringTravel).toBeLessThanOrEqual(travelingRateUpperBound);
  });

  it('drains the outbound walk to a claimed job and the return walk to rest by the SAME amount (symmetric traveling tier, #928)', () => {
    // The bug #928 fixes: outbound (to a claimed job) used to bill at
    // 'working' (2/tick) while the return-to-rest walk billed at 'idle'
    // (0.5/tick) — an asymmetric drain for the same physical act of walking
    // a fixed distance. Both now bill at 'traveling' (1/tick).
    const outboundCtx = makeCtx();
    const outboundEmpId = hireOne(outboundCtx, 'driller');
    const outboundEmp = getEmployee(outboundCtx, outboundEmpId);
    outboundEmp.activeActionId = 7; // claimed a job, walking to it
    outboundEmp.pendingTaskDuration = 12;
    outboundEmp.fatigue = 100;

    const returnCtx = makeCtx();
    const returnEmpId = hireOne(returnCtx, 'driller');
    const returnEmp = getEmployee(returnCtx, returnEmpId);
    returnEmp.pendingRestDuration = 8; // walking to living_quarters
    returnEmp.fatigue = 100;

    tickCommand(outboundCtx, ['1'], {});
    tickCommand(returnCtx, ['1'], {});

    expect(outboundEmp.fatigue).toBe(returnEmp.fatigue);
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
  it('charges NEED_REST_COSTS.fatigue once and restores the gauge once', () => {
    const ctx = makeCtx();
    const empId = hireOne(ctx, 'driller');
    const state = ctx.state!;
    const emp = getEmployee(ctx, empId);

    state.cash = 100_000;
    buildLivingQuartersAndComplete(ctx, '5,5');

    emp.x = 0;
    emp.z = 0;
    emp.activeActionId = null;
    emp.destinationX = null;
    emp.destinationZ = null;
    emp.fatigue = 24; // just below the 25 warning threshold

    // The employee is routed toward the living_quarters on the very first
    // tick, but (issue #437) the rest timer must not start until they have
    // actually walked there — routing alone is not resolution.
    tickCommand(ctx, ['1'], {});
    expect(emp.destinationX).not.toBeNull();
    expect(emp.destinationZ).not.toBeNull();
    expect(emp.restTicksRemaining).toBeNull();

    // Long enough for the walk to (5,5) plus the full rest duration, with slack,
    // but short of the ~14-tick idle fatigue decay (NEED_DRAIN_RATES.fatigue.idle)
    // that would otherwise dip the gauge below the warning threshold a second
    // time and start an unrelated second rest cycle — this test is only about
    // the first, deliberately-triggered dip.
    for (let i = 0; i < 12; i++) tickCommand(ctx, ['1'], {});

    const restCharges = state.finances.transactions.filter(t => t.category === 'needs');
    // #928: NEED_REST_COSTS.fatigue = 0 — a zero-amount expense is never
    // recorded (addExpense no-ops on amount <= 0), so the single dip this
    // test drives produces zero finance transactions, not one.
    expect(restCharges).toHaveLength(0);
    expect(emp.restTicksRemaining).toBeNull();
    expect(emp.restNeedKey).toBeNull();
    expect(emp.activeActionId).toBeNull();
    expect(emp.fatigue).toBeGreaterThan(NEED_WARNING_THRESHOLDS.fatigue);
    expect(state.pendingActions.filter(a => a.type === 'rest')).toHaveLength(0);
  });

  // ── New (issue #437): rest must not tick down while still travelling ──────

  it('does not decrement restTicksRemaining while the employee is still travelling to the living_quarters', () => {
    const ctx = makeCtx();
    const empId = hireOne(ctx, 'driller');
    const state = ctx.state!;
    const emp = getEmployee(ctx, empId);

    state.cash = 100_000;
    buildLivingQuartersAndComplete(ctx, '20,20');

    emp.x = 0;
    emp.z = 0;
    emp.activeActionId = null;
    emp.destinationX = null;
    emp.destinationZ = null;
    emp.fatigue = 20; // below warning threshold — triggers routing

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
    // and finish the rest (NEED_REST_DURATIONS.fatigue ticks of work once
    // arrival gates the timer open), with slack.
    const travelTicks = Math.ceil(Math.hypot(20, 20) / AGENT_WALK_SPEED);
    for (let i = 0; i < travelTicks + NEED_REST_DURATIONS.fatigue + 10; i++) tickCommand(ctx, ['1'], {});

    expect(emp.restTicksRemaining).toBeNull(); // completed and cleared
    expect(emp.fatigue).toBeGreaterThan(NEED_WARNING_THRESHOLDS.fatigue);
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
// applied policy keeps the fatigue gauge itself off the floor; without one,
// only the pre-existing (unrelated, unchanged by #678) collapse safety net
// protects the employee, and it lets the run reach collapse territory that
// an applied policy's tighter threshold never approaches.
//
// scores.wellBeing tracks avgMorale (ScoreManager.updateScores), and morale
// is driven by needsMoraleEffect (EmployeeNeeds.ts), which penalizes the
// gauge below its own "comfortable" threshold of 50. SITE_POLICY_DEFAULT_
// THRESHOLD (src/core/config/balance.ts) now sits at fatigue:60 (#928 —
// single gauge) — at or above that comfortable band — so a policy-protected
// employee no longer spends the run in morale's penalty zone, and wellBeing
// stays off the floor alongside fatigue.

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

  it('keeps fatigue and scores.wellBeing above 0 across a long run when a policy is applied', () => {
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

    let minFatigue = 100;
    let minWellBeing = 100;

    driveContinuousWork(ctx, empId, RUN_TICKS, (emp) => {
      minFatigue = Math.min(minFatigue, emp.fatigue);
      minWellBeing = Math.min(minWellBeing, state.scores.wellBeing);
    });

    expect(sawForcedRestTransition).toBe(true);
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
    let minFatigue = 100;

    driveContinuousWork(ctx, empId, RUN_TICKS, (emp) => {
      sawCollapse = sawCollapse || emp.collapsing;
      minFatigue = Math.min(minFatigue, emp.fatigue);
    });

    expect(sawCollapse).toBe(true);
    expect(minFatigue).toBeLessThanOrEqual(NEED_COLLAPSE_THRESHOLDS.fatigue);
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

    let minFatigue = 100;
    driveContinuousWork(ctx, empId, RUN_TICKS, (emp) => {
      minFatigue = Math.min(minFatigue, emp.fatigue);
    });

    // Sanity check that the run actually exercised the needs-drain/rest
    // machinery rather than trivially never engaging it — a driller working
    // continuously for 400 ticks must dip its gauge below the starting 100
    // at some point (drained by working, restored by the shift's rest
    // cycles). A frozen tickNeedGauges (needs-drain unimplemented) would
    // leave the gauge pinned at 100 the entire run and fail this.
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

// ─────────────────────────────────────────────────────────────────────────────
// #928 — travel-drain fix, measured on the box-cut geometry over a fixed
// window against the pre-fix baseline.
//
// Same repro as the tutorial full-level box-cut performance test
// (tests/integration/full-level/tutorial.integration.test.ts): a staffed
// tutorial_pit roster orders a living_quarters, waits 40 ticks, opts into
// continuous shift mode, then orders the box-cut ramp segment. Over a FIXED
// window of console ticks starting right after that order (long enough for
// both the pre- and post-fix box-cut to complete: the pre-fix issue measured
// 114 ticks to completion, the post-fix run measures 66), this suite proves
// the two integration-level symptoms the fix addresses:
//
//   - "rest visits" (restTicksRemaining transitioning null -> non-null,
//     i.e. a rest actually starting) fall, because the asymmetric
//     working/idle drain no longer forces extra trips.
//   - "cells walked" (summed |dx|+|dz| across every employee, every tick)
//     falls, because fewer interrupted walks means less backtracking.
//
// Baselines below were measured directly against the pre-#928 commit
// (5a17b28, the parent of the skeleton commit) via a `git worktree` checkout
// running the identical repro and instrumentation — the same methodology
// tests/integration/full-level/tutorial.integration.test.ts's own
// PRE_FIX_BASELINE_TICKS documents.
//
// The suite also asserts the walk-survival guard's own integration-level
// invariant directly: no employee ever has their claimed action's
// 'employee:shift_change' (ForceShiftRest.ts's own proactive-rest event)
// fire while `pendingTaskDuration !== null` on that same employee — i.e. a
// proactive forced rest is never allowed to observably fire against an
// employee mid-walk to an already-claimed job. tickCollapse's own
// unconditional interrupt (a genuine collapse) is a distinct code path and
// is deliberately NOT covered by this invariant — it fires
// 'employee:collapsed', not 'employee:shift_change', so it can never
// trigger a false positive here.
// ─────────────────────────────────────────────────────────────────────────────
describe('#928 — box-cut geometry: rest visits and cells walked both fall vs. the pre-fix baseline', () => {
  const FIXED_WINDOW_TICKS = 150;
  // Measured directly against 5a17b28 (pre-#928) via the same repro/window.
  const PRE_FIX_CELLS_WALKED = 285.49593120068437;
  const PRE_FIX_REST_VISITS = 21;

  it('walks fewer cells and starts fewer rests than the pre-fix baseline, with no claimed job dropped mid-walk to it', () => {
    const engine = createGameEngine();

    expect(runCommand(engine, 'campaign start level:tutorial_pit staffed:true').success).toBe(true);
    expect(runCommand(engine, 'build living_quarters at:18,14').success).toBe(true);
    expect(runCommand(engine, 'tick 40').success).toBe(true);
    expect(runCommand(engine, 'set_policy mode:continuous').success).toBe(true);
    expect(runCommand(engine, 'build_ramp start:16,19 end:16,31 depth:8').success).toBe(true);

    const state = engine.ctx.state!;

    let cellsWalked = 0;
    let restVisits = 0;
    // Employee ids whose 'employee:shift_change' fired during the tick just
    // taken — reset every tick, populated by the emitter listener below.
    let shiftChangedThisTick = new Set<number>();
    engine.ctx.emitter.on('employee:shift_change', (payload: unknown) => {
      shiftChangedThisTick.add((payload as { employeeId: number }).employeeId);
    });

    // The walk-survival guard's own violation counter: an 'employee:shift_change'
    // firing for an employee who had pendingTaskDuration !== null (mid-walk to
    // a claimed job) immediately before that same tick.
    let interruptedWhileTravelingToClaim = 0;

    function snapshotEmployees(): Map<number, { x: number; z: number; restTicksRemaining: number | null; pendingTaskDuration: number | null }> {
      const m = new Map();
      for (const e of state.employees.employees) {
        m.set(e.id, { x: e.x, z: e.z, restTicksRemaining: e.restTicksRemaining, pendingTaskDuration: e.pendingTaskDuration });
      }
      return m;
    }

    for (let i = 0; i < FIXED_WINDOW_TICKS; i++) {
      const empBefore = snapshotEmployees();
      shiftChangedThisTick = new Set();

      runCommand(engine, 'tick 1');
      if (state.events.pendingEvent) runCommand(engine, 'event choose 0');

      for (const e of state.employees.employees) {
        const before = empBefore.get(e.id);
        if (!before) continue;
        cellsWalked += Math.abs(e.x - before.x) + Math.abs(e.z - before.z);
        if (before.restTicksRemaining === null && e.restTicksRemaining !== null) {
          restVisits++;
        }
      }

      for (const empId of shiftChangedThisTick) {
        const before = empBefore.get(empId);
        if (before && before.pendingTaskDuration !== null) {
          interruptedWhileTravelingToClaim++;
        }
      }
    }

    expect(cellsWalked).toBeLessThan(PRE_FIX_CELLS_WALKED);
    expect(restVisits).toBeLessThan(PRE_FIX_REST_VISITS);
    // The walk-survival guard's own integration-level invariant: over the
    // whole window, no claimed job was ever dropped by a proactive forced
    // rest while its holder was still mid-walk to it.
    expect(interruptedWhileTravelingToClaim).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #945 — same tutorial box-cut repro as the #928 suite above, but proving the
// tighter, additive fix: #928 only stopped a proactive rest from preempting
// an employee mid-WALK to a claimed job (pendingTaskDuration !== null). It
// left a gap for an employee already arrived and mid-EXECUTION of that job
// (taskTicksRemaining !== null, e.g. mid dig_ramp_segment) — still
// preemptable once WORK_DURATION_TICKS/the site policy's threshold was
// crossed. On the box-cut ramp order, that gap repeatedly knocks the
// rock-digger driver off its vehicle mid-segment, forcing it to dismount,
// walk to rest, and re-board over and over.
//
// This test drives the identical order sequence used above and counts
// 'vehicle:driver_boarded' events (ArrivalGate.ts) against the rock_digger
// vehicle specifically, rather than a fixed employee id: the bug is a
// per-vehicle dismount/reboard cycle, and gating on vehicleId (stable for
// the whole run) is robust to a different qualified driver picking up the
// same vehicle after a legitimate handoff, whereas a fixed employee id is
// not. Bounded by polling until no dig_ramp_segment PendingActions remain
// (max 200 ticks) rather than a fixed tick count, per dev-testing-strategy's
// wait-on-condition rule.
// ─────────────────────────────────────────────────────────────────────────────
describe('#945 — tutorial box-cut ramp: rock-digger driver boards at most 2 times for the whole order', () => {
  const MAX_TICKS = 200;
  // The initial boarding, plus at most one legitimate policy-forced handoff
  // (fixer follow-up) — NOT the 12 dismount/reboard cycles the pre-fix bug
  // produced, and not the 3 an earlier fixer round settled for. Three root
  // causes were fixed:
  //  1. tickTaskCompletion.ts's dig_ramp_segment completion marked the
  //     segment's own tracker.done AFTER the same-tick vehicle-continuity
  //     attempt (tryContinueVehicleGatedAction) already ran — so
  //     isRampSegmentClaimable always saw the just-finished segment as not
  //     yet done and rejected every same-vehicle follow-up, dismounting the
  //     driver once per segment regardless of fatigue. Reordered so the
  //     segment is marked done first.
  //  2. ForceShiftRest.ts's forceShiftRestIfNeededByPolicy needed a guard
  //     against preempting a driver already arrived and mid-execution of a
  //     vehicle-gated segment (isMidVehicleGatedWork, VehicleReservation.ts)
  //     — but scoped to vehicle-gated work specifically, not a blanket
  //     taskTicksRemaining check: a blanket guard also deferred a policy-
  //     forced rest for an unrelated, long-running on-foot task's entire
  //     duration, letting fatigue swing far past the policy's own threshold
  //     every work cycle (needs.integration.test.ts's own pre-existing
  //     "#678" long-run wellBeing/revolt acceptance cases, regressed by an
  //     earlier, broader version of this same guard).
  //  3. TaskCancellation.ts's interruptActiveAction pinned a mid-INTERRUPTED
  //     action back to the same employee (the #556/#867 walk-only pin) only
  //     when employee.pendingTaskDuration !== null — which a vehicle-gated
  //     action's own mid-drive phase never sets (seedTaskTimerFields is
  //     deferred until the VEHICLE, not the employee, reaches the target),
  //     so an interrupted driver's own action fell straight through to an
  //     unpinned open-pool release. On this map the rock_digger's only other
  //     licensed driver was farther from the segment target than the
  //     interrupted driver's own already-covered position, so cost-ranking
  //     alone (estimateActionCost) should never have preferred them — but
  //     with no pin at all, the open pool offered the action to them anyway,
  //     and they drove only 3 ticks before their own fatigue forced them off
  //     again too: an aborted takeover, a wasted dismount/reboard cycle, and
  //     the 3rd boarding an earlier fixer round wrongly accepted as an
  //     unavoidable floor. Extending the existing pin to also cover a
  //     vehicle-gated mid-drive interruption (isMidVehicleGatedWork,
  //     narrowed to taskTicksRemaining === null so mid-execution — already
  //     separately protected — is untouched) reuses hasCloserIdleCandidate's
  //     existing distance comparison to decide whether releasing the pin is
  //     even worth it, exactly as #556/#867 already do for an on-foot walk.
  // With all three fixed, every one of the ramp's 12 segments hands off to
  // the next with zero reboarding, and the ONE long initial approach drive to
  // the first segment (a real travel distance from the staffed fleet's
  // rock_digger spawn point on this map) produces exactly one proactive
  // handoff back to the SAME interrupted driver once their own forced rest
  // completes — never a different, farther-away one — for 2 boardings total,
  // confirmed directly against this exact scenario.
  const MAX_EXPECTED_BOARDINGS = 2;

  it('boards the rock_digger vehicle no more than 2 times while carving the whole box-cut ramp', () => {
    const engine = createGameEngine();

    expect(runCommand(engine, 'campaign start level:tutorial_pit staffed:true').success).toBe(true);
    expect(runCommand(engine, 'build living_quarters at:18,14').success).toBe(true);
    expect(runCommand(engine, 'tick 40').success).toBe(true);
    expect(runCommand(engine, 'set_policy mode:continuous').success).toBe(true);
    expect(runCommand(engine, 'build_ramp start:16,19 end:16,31 depth:8').success).toBe(true);

    const state = engine.ctx.state!;
    const rockDigger = state.vehicles.vehicles.find(v => v.type === 'rock_digger');
    if (!rockDigger) throw new Error('Setup: no rock_digger vehicle in the staffed starting fleet');
    const rockDiggerVehicleId = rockDigger.id;

    let boardingCount = 0;
    engine.ctx.emitter.on('vehicle:driver_boarded', (payload: unknown) => {
      const { vehicleId } = payload as { employeeId: number; vehicleId: number };
      if (vehicleId === rockDiggerVehicleId) boardingCount++;
    });

    let ticks = 0;
    while (
      ticks < MAX_TICKS
      && state.pendingActions.some(a => a.type === 'dig_ramp_segment')
    ) {
      runCommand(engine, 'tick 1');
      if (state.events.pendingEvent) runCommand(engine, 'event choose 0');
      ticks++;
    }

    expect(ticks).toBeLessThan(MAX_TICKS); // the box-cut must actually finish within the bound
    expect(boardingCount).toBeLessThanOrEqual(MAX_EXPECTED_BOARDINGS);
  });
});
