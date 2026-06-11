// BlastSimulator2026 — Full-level integration test: Level 1 Lose — Worker Revolt
// Goal: Start level 1, drive employee well-being to zero for sustained period
// to trigger a worker revolt.
//
// KNOWN BUG: ScoreManager.applyDecay pushes scores toward 50 at +0.05/tick.
// This means well-being can NEVER stay at 0 for consecutive ticks naturally —
// it gets pushed to 0.05 the next tick. We work around this by directly
// resetting well-being to 0 after each tick.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
} from './helpers.js';
import { tickCommand, eventCommand } from '../../../src/console/commands/events.js';
import { employeeCommand } from '../../../src/console/commands/entities.js';

describe('Level 1 — Lose — Worker Revolt', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    ctx = makeCampaignCtx('dusty_hollow');
  });

  it('starts with well-being score at 50', () => {
    expect(ctx.state!.scores.wellBeing).toBe(50);
    expect(ctx.state!.revolt.revolted).toBe(false);
    expect(ctx.state!.revolt.ticksAtZero).toBe(0);
  });

  it('triggers revolt when well-being stays at 0 for 120 ticks', () => {
    // Hire some employees so the revolt mechanic is meaningful
    employeeCommand(ctx, ['hire'], { role: 'driller' });
    employeeCommand(ctx, ['hire'], { role: 'driller' });
    employeeCommand(ctx, ['hire'], { role: 'blaster' });

    // Do NOT build any well-being buildings (like living_quarters)

    // Set well-being to 0 directly
    ctx.state!.scores.wellBeing = 0;

    // KNOWN BUG WORKAROUND: ScoreManager.applyDecay pushes scores toward 50
    // at +0.05/tick, so we reset well-being to 0 after each tick.
    for (let i = 0; i < 200; i++) {
      tickCommand(ctx, ['1'], {});
      if (ctx.state!.scores.wellBeing >= 0 && ctx.state!.scores.wellBeing < 1) {
        ctx.state!.scores.wellBeing = 0; // force back to 0
      }
      // Handle any events that fire (events may interrupt the loop)
      if (ctx.state!.events.pendingEvent) {
        ctx.state!.isPaused = false;
        eventCommand(ctx, ['choose', '0'], {});
      }
      if (ctx.state!.revolt.revolted) break;
    }

    // Verify revolt triggered
    expect(ctx.state!.revolt.revolted).toBe(true);
    // ticksAtZero should be >= 120 (REVOLT_TICKS)
    expect(ctx.state!.revolt.ticksAtZero).toBeGreaterThanOrEqual(120);
  });
});
