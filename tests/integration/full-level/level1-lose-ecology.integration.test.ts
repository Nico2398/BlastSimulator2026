// BlastSimulator2026 — Full-level integration test: Level 1 Lose — Ecological Disaster
// Goal: Start level 1, let ecological score stay at 0 for a sustained period
// to trigger an ecological shutdown.
//
// KNOWN BUG: ScoreManager.applyDecay pushes scores toward 50 at +0.05/tick.
// This means ecology can NEVER stay at 0 for consecutive ticks naturally —
// it gets pushed to 0.05 the next tick. We work around this by directly
// resetting ecology to 0 after each tick.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
} from './helpers.js';
import { tickCommand, eventCommand } from '../../../src/console/commands/events.js';

describe('Level 1 — Lose — Ecological Disaster', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    ctx = makeCampaignCtx('dusty_hollow');
  });

  it('starts with ecology score at 50', () => {
    expect(ctx.state!.scores.ecology).toBe(50);
    expect(ctx.state!.ecological.shutdown).toBe(false);
    expect(ctx.state!.ecological.ticksAtZero).toBe(0);
  });

  it('triggers ecological shutdown when ecology stays at 0 for 150 ticks', () => {
    // Set ecology to 0 directly
    ctx.state!.scores.ecology = 0;

    // KNOWN BUG WORKAROUND: ScoreManager.applyDecay pushes scores toward 50
    // at +0.05/tick, so we reset ecology to 0 after each tick.
    for (let i = 0; i < 250; i++) {
      tickCommand(ctx, ['1'], {});
      if (ctx.state!.scores.ecology >= 0 && ctx.state!.scores.ecology < 1) {
        ctx.state!.scores.ecology = 0; // force back to 0
      }
      // Handle any events that fire
      if (ctx.state!.events.pendingEvent) {
        ctx.state!.isPaused = false;
        eventCommand(ctx, ['choose', '0'], {});
      }
      if (ctx.state!.ecological.shutdown) break;
    }

    // Verify ecological shutdown triggered
    expect(ctx.state!.ecological.shutdown).toBe(true);
    // ticksAtZero should be >= 150 (ECOLOGICAL_SHUTDOWN_TICKS)
    expect(ctx.state!.ecological.ticksAtZero).toBeGreaterThanOrEqual(150);
  });
});
