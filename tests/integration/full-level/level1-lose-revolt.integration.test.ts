// BlastSimulator2026 — Full-level integration test: Level 1 Lose — Worker Revolt
// Goal: Start level 1, drive employee well-being to zero for sustained period
// to trigger a worker revolt.
//
// Strategy: Do NOT hire any employees (avgMorale defaults to 50, meaning no
// well-being delta from morale). With no buildings and no employees,
// ScoreManager.updateScores leaves well-being at 0, and the applyDecay fix
// ensures scores at 0 stay at 0 (never pushed upward).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
} from './helpers.js';
import { tickCommand, eventCommand } from '../../../src/console/commands/events.js';

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
    // IMPORTANT: Do NOT hire employees. Without employees, avgMorale = 50,
    // and with no buildings, well-being delta is 0. Combined with the
    // applyDecay fix (scores at 0 stay at 0), well-being remains at 0
    // through each tick, allowing the revolt counter to accumulate.

    // Set well-being to 0 directly
    ctx.state!.scores.wellBeing = 0;

    // Tick 130 times — well-being stays at 0 because:
    // 1. No employees → avgMorale=50 → wbDelta=0
    // 2. No buildings → buildingEffects.wellBeing=0
    // 3. applyDecay(0, 0.05) → 0 (fix keeps 0 at 0)
    for (let i = 0; i < 130; i++) {
      tickCommand(ctx, ['1'], {});
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
