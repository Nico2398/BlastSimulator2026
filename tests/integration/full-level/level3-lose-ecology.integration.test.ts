// BlastSimulator2026 — Full-level integration test: Level 3 Lose — Ecological Disaster
// Goal: Start level 3, let ecological score stay at 0 for a sustained period
// to trigger an ecological shutdown.
//
// NOTE: ScoreManager.applyDecay was historically pushing scores up from 0 toward 50.
// This has been fixed (value > 0 guard) so scores at exactly 0 stay at 0 through
// decay. With no buildings and no employees, ecology remains at 0 naturally.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtxWithUnlock,
} from './helpers.js';
import { tickCommand, eventCommand } from '../../../src/console/commands/events.js';

describe('Level 3 — Lose — Ecological Disaster', () => {
  let ctx: ReturnType<typeof makeCampaignCtxWithUnlock>;

  beforeEach(() => {
    ctx = makeCampaignCtxWithUnlock('treranium_depths');
  });

  it('starts level 3 with ecology score at 50', () => {
    expect(ctx.state!.scores.ecology).toBe(50);
    expect(ctx.state!.ecological.shutdown).toBe(false);
    expect(ctx.state!.ecological.ticksAtZero).toBe(0);
  });

  it('triggers ecological shutdown when ecology stays at 0 for 150 ticks', () => {
    // Set ecology to 0 directly
    ctx.state!.scores.ecology = 0;

    // Tick up to 200 ticks — ecology stays at 0 because:
    // 1. No employees → avgMorale=50 → no score deltas
    // 2. No buildings → buildingEffects.ecology=0
    // 3. applyDecay(0, rate) → 0 (fix keeps 0 at 0)
    for (let i = 0; i < 200; i++) {
      tickCommand(ctx, ['1'], {});
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
