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
import { REVOLT_TICKS } from '../../../src/core/config/balance.js';

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
