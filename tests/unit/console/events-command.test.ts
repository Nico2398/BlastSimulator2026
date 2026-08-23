// BlastSimulator2026 — Unit tests: buildEventContext (#592)
//
// buildEventContext (src/console/commands/events.ts) feeds EventContext to the
// event prerequisite/weighting system. Its employeeCount field used to read
// state.employees.employees.length unfiltered — same class of bug as
// avgMorale (Employee.ts's computeAverageMorale): killEmployee never splices
// the roster, only flips alive:false, so a corpse permanently inflated the
// count fed to every event's canFire/weightCoeff check.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { buildEventContext, tickCommand, eventCommand } from '../../../src/console/commands/events.js';
import { killEmployee } from '../../../src/core/entities/Employee.js';
import { REVOLT_TICKS, NEED_WELL_RESTED_THRESHOLD } from '../../../src/core/config/balance.js';

describe('buildEventContext (#592)', () => {
  it('reports employeeCount over the living roster only, excluding a killed employee still physically present in the array', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game mine_type:desert seed:42');
    runner.run('employee hire role:driller');
    runner.run('employee hire role:driller');
    runner.run('employee hire role:driller');
    const employees = ctx.state!.employees.employees;
    killEmployee(ctx.state!.employees, employees[1]!.id);

    // killEmployee only flips alive:false — the roster still physically
    // holds all 3 entries.
    expect(ctx.state!.employees.employees).toHaveLength(3);

    const eventCtx = buildEventContext(ctx);

    expect(eventCtx.employeeCount).toBe(2);
  });
});

describe('revolt end-condition is unconditional (#682)', () => {
  it('ends the level with worker_revolt once wellBeing holds at 0 for REVOLT_TICKS, with no disable path left', () => {
    // #682 removed the temporary revolt-suppression cheat (issue #631) —
    // GameState's former revolt-disable flag and events.ts's tick-loop guard
    // around it.
    // There is no code path left that can suppress this outcome once the
    // condition holds — the tick loop's revolt check
    // (`} else if (revolted) {`) is unconditional. This test drives that
    // condition through the console's own `tick` command rather than calling
    // WorkerRevolt.updateRevolt directly, so it proves the console-layer
    // wiring, not just the core function (that's WorkerRevolt.test.ts's job).
    //
    // No employees hired: computeAverageMorale defaults an empty living
    // roster to 50, so avgMorale-50=0 contributes no well-being delta; no
    // buildings placed means buildingEffects.wellBeing is also 0. Combined
    // with ScoreManager.applyDecay pinning a score already at exactly 0 (it
    // never nudges 0 back toward the 50 neutral point), wellBeing forced to
    // 0 stays at 0 through every subsequent tick — see
    // level1-lose-revolt.integration.test.ts for the same technique.
    const { runner, ctx } = createRunner();
    runner.run('new_game mine_type:desert seed:42');

    ctx.state!.scores.wellBeing = 0;

    // Tick past REVOLT_TICKS, resolving any unrelated random event that
    // fires and pauses the loop along the way (mirrors
    // level1-lose-revolt.integration.test.ts).
    for (let i = 0; i < REVOLT_TICKS + 10; i++) {
      tickCommand(ctx, ['1'], {});
      if (ctx.state!.events.pendingEvent) {
        ctx.state!.isPaused = false;
        eventCommand(ctx, ['choose', '0'], {});
      }
      if (ctx.state!.revolt.revolted) break;
    }

    expect(ctx.state!.revolt.revolted).toBe(true);
    expect(ctx.state!.revolt.ticksAtZero).toBeGreaterThanOrEqual(REVOLT_TICKS);
    expect(ctx.state!.levelEndReason).toBe('worker_revolt');
    expect(ctx.state!.levelEnded).toBe(true);
  });
});

describe('employee morale clamp boundaries (#732 — shared clampScore helper)', () => {
  // tickCommand's needs loop (src/console/commands/events.ts) currently clamps
  // morale inline with Math.max(0, Math.min(100, ...)). #732 swaps that for
  // the already-exported clampScore (src/core/scores/ScoreManager.ts), which
  // is mathematically identical — these tests pin the observable behavior at
  // both ends of the 0–100 range so the swap can't silently change it.
  //
  // tickCommand's needs loop runs tickNeedGauges (which drains hunger/
  // fatigue/breakNeed for this tick) BEFORE computing needsMoraleEffect off
  // the now-drained gauge values, both within the same tick (events.ts lines
  // 184–185). Gauge values below are set with enough margin that one tick's
  // drain cannot cross a needsMoraleEffect threshold bucket.

  it('floor: morale cannot drop below 0 even when all three need gauges are critical', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game mine_type:desert seed:42');
    runner.run('employee hire role:driller');

    const emp = ctx.state!.employees.employees[0]!;
    emp.morale = 0;
    // Below NEED_MORALE_EFFECT_THRESHOLDS.suffering (15) on all three gauges
    // → needsMoraleEffect's most negative per-gauge bucket (critical, -3.0
    // each) fires for hunger, fatigue, and breakNeed simultaneously.
    emp.hunger = 5;
    emp.fatigue = 5;
    emp.breakNeed = 5;

    tickCommand(ctx, ['1'], {});
    if (ctx.state!.events.pendingEvent) {
      ctx.state!.isPaused = false;
      eventCommand(ctx, ['choose', '0'], {});
    }

    expect(emp.morale).toBe(0);
    expect(emp.morale).toBeGreaterThanOrEqual(0);
  });

  it('ceiling: morale cannot rise above 100 when all three need gauges are well-rested', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game mine_type:desert seed:42');
    runner.run('employee hire role:driller');

    const emp = ctx.state!.employees.employees[0]!;
    emp.morale = 100;
    // Well above NEED_WELL_RESTED_THRESHOLD (80) on all three gauges, with
    // enough margin that one tick's drain (idle: <=0.5/gauge, further scaled
    // by the morale drain multiplier) cannot pull any gauge back down to the
    // threshold — needsMoraleEffect awards the "comfortable" bucket (0 each)
    // plus the +1 well-rested bonus, for a net of +1.
    const wellRestedValue = NEED_WELL_RESTED_THRESHOLD + 10;
    emp.hunger = wellRestedValue;
    emp.fatigue = wellRestedValue;
    emp.breakNeed = wellRestedValue;

    tickCommand(ctx, ['1'], {});
    if (ctx.state!.events.pendingEvent) {
      ctx.state!.isPaused = false;
      eventCommand(ctx, ['choose', '0'], {});
    }

    expect(emp.morale).toBe(100);
    expect(emp.morale).toBeLessThanOrEqual(100);
  });
});
