// BlastSimulator2026 — Full-level integration test: Level 1 Lose — Bankruptcy
// Goal: Start level 1, drive cash to zero / max debt, and verify the
// bankruptcy:triggered event fires and the level ends in loss.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
} from './helpers.js';
import { buildCommand, employeeCommand } from '../../../src/console/commands/entities.js';

describe('Level 1 — Lose — Bankruptcy', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    ctx = makeCampaignCtx('dusty_hollow');
  });

  it('starts with correct cash for level 1', () => {
    expect(ctx.state!.cash).toBe(50000);
    expect(ctx.state!.bankruptcy.bankrupt).toBe(false);
    expect(ctx.state!.bankruptcy.ticksBelowThreshold).toBe(0);
  });

  it('triggers bankruptcy when cash stays below $5,000 for 100 ticks', () => {
    // Spend money to drain cash below $5,000.
    // Calibrated on $25,000 (the Research Center is gone, #2283, so the spend-down
    // below adds up to less than the level's $50,000 opening cash):
    // Hire 5 drillers: 5 x $1,000 = $5,000 -> $20,000
    ctx.state!.cash = 25000;
    ctx.state!.finances.cash = 25000;
    for (let i = 0; i < 5; i++) {
      employeeCommand(ctx, ['hire'], { role: 'driller' });
    }

    // Build management_office ($8k) -> $12,000
    // Build living_quarters ($10k) -> $2,000
    // That should be under $5k.
    //
    // Coordinates below are not the original (5,5)/(10,5)/(15,5): #1008 wired
    // a flatness check into the real placement path, and none of those three
    // sit on flat ground on dusty_hollow's own terrain (terrainSeed 1138) —
    // an order refused there charges nothing, so cash would stay at $45,000
    // and bankruptcy would never trigger. These are the nearest flat,
    // non-overlapping spots for each building's own footprint.
    buildCommand(ctx, ['management_office'], { at: '9,4' });
    buildCommand(ctx, ['living_quarters'], { at: '14,0' });

    // Verify cash is below $5,000
    expect(ctx.state!.cash).toBeLessThan(5000);

    // Tick 110 times (bankruptcy requires 100 ticks below threshold)
    tickWithEvents(ctx, 110);

    // Verify bankruptcy triggered
    expect(ctx.state!.bankruptcy.bankrupt).toBe(true);
    // ticksBelowThreshold may have accumulated some ticks before we hit 100,
    // but should be >= 100 by now
    expect(ctx.state!.bankruptcy.ticksBelowThreshold).toBeGreaterThanOrEqual(100);

    // Verify the level itself ends, with the reason attributed to bankruptcy
    expect(ctx.state!.levelEnded).toBe(true);
    expect(ctx.state!.levelEndReason).toBe('bankruptcy');
  });

  it('does not trigger bankruptcy when cash recovers above threshold', () => {
    // Force cash below $5,000 threshold directly
    ctx.state!.cash = 1000;

    // Tick 30 times to accumulate some ticks below threshold
    tickWithEvents(ctx, 30);
    expect(ctx.state!.bankruptcy.ticksBelowThreshold).toBeGreaterThanOrEqual(30);
    expect(ctx.state!.bankruptcy.bankrupt).toBe(false);

    // Recover cash above threshold
    ctx.state!.cash = 10000;
    tickWithEvents(ctx, 5);

    // Bankruptcy counter should have been reset
    expect(ctx.state!.bankruptcy.bankrupt).toBe(false);
    expect(ctx.state!.bankruptcy.ticksBelowThreshold).toBe(0);

    // A recovered streak must not have ended the level
    expect(ctx.state!.levelEnded).toBe(false);
    expect(ctx.state!.levelEndReason).toBeNull();
  });
});
