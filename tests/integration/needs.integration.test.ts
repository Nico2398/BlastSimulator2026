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

    tickNeedGauges(emp, true);

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
    tickNeedGauges(emp, true);
    const workingHunger = emp.hunger;
    const workingFatigue = emp.fatigue;
    const workingBreak = emp.breakNeed;

    // Reset and do one idle tick
    emp.hunger = 100;
    emp.fatigue = 100;
    emp.breakNeed = 100;
    tickNeedGauges(emp, false);

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

    tickNeedGauges(emp, true);

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

// ── tick command — resting employee drains at idle rate, not working rate ────
//
// Fixes the bug where a resting employee (activeActionId set to the rest
// action, restTicksRemaining non-null) was drained at the working rate
// because the old isWorking check only looked at activeActionId. See
// src/console/commands/events.ts: isWorking now also requires
// restTicksRemaining === null.

describe('tick command — idle-vs-working drain rate for resting employees', () => {
  let ctx: GameContext;
  let empId: number;

  beforeEach(() => {
    ctx = makeCtx();
    empId = hireOne(ctx);
  });

  it('drains a resting employee at the idle rate during tick', () => {
    const emp = getEmployee(ctx, empId);
    // Simulate mid-rest: claimed by a rest action, timer running.
    emp.activeActionId = 999;
    emp.restTicksRemaining = 10;
    emp.restNeedKey = null; // not owned by tickGeneralRestCompletion or processShiftCycle
    emp.hunger = 100;
    emp.breakNeed = 100;

    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(true);
    // idle rate: hunger drains 0.5/tick (not 1 as it would while genuinely working)
    expect(emp.hunger).toBe(99.5);
    // idle rate: breakNeed does not drain at all while idle (0, vs 0.8 working)
    expect(emp.breakNeed).toBe(100);
    // Rest state itself is untouched by the needs-drain step.
    expect(emp.restTicksRemaining).toBe(10);
    expect(emp.activeActionId).toBe(999);
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
// scores.wellBeing is deliberately NOT asserted here. It tracks avgMorale
// (ScoreManager.updateScores), and morale is driven by needsMoraleEffect
// (EmployeeNeeds.ts), which penalizes any gauge below its own "comfortable"
// threshold of 50 — well above SitePolicy's rest thresholds (hunger 40,
// fatigue 25). A continuously-working employee spends real time in that
// 30-49/15-29 band even when correctly protected from ever collapsing, so
// morale — and with it wellBeing, via applyDecay's deliberate zero-pinning,
// same mechanism level1-lose-revolt/level1-lose-ecology depend on — can
// still reach 0. That's the pre-existing morale system working as designed
// (gameplay-employee-needs), not a gap in shouldForceRest/
// getEffectiveThresholds: #678 only asked the policy to force rest at its
// own thresholds, never to keep every gauge above morale's comfortable band.

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

  it('keeps hunger and fatigue above 0 across a long run when a policy is applied', () => {
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

    driveContinuousWork(ctx, empId, RUN_TICKS, (emp) => {
      minHunger = Math.min(minHunger, emp.hunger);
      minFatigue = Math.min(minFatigue, emp.fatigue);
    });

    expect(sawForcedRestTransition).toBe(true);
    expect(minHunger).toBeGreaterThan(0);
    expect(minFatigue).toBeGreaterThan(0);
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
