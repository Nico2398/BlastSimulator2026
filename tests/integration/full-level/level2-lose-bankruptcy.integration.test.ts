// BlastSimulator2026 — Full-level integration test: Level 2 Lose — Bankruptcy
// Goal: Start level 2, drive cash to below $5,000, and verify the
// bankruptcy triggers after 100 consecutive ticks.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtxWithUnlock,
  tickWithEvents,
} from './helpers.js';
import { buildCommand, employeeCommand } from '../../../src/console/commands/entities.js';

describe('Level 2 — Lose — Bankruptcy', () => {
  let ctx: ReturnType<typeof makeCampaignCtxWithUnlock>;

  beforeEach(() => {
    ctx = makeCampaignCtxWithUnlock('grumpstone_ridge');
  });

  it('starts level 2 with correct cash', () => {
    expect(ctx.state!.cash).toBe(75000);
    expect(ctx.state!.bankruptcy.bankrupt).toBe(false);
  });

  it('triggers bankruptcy when cash stays below $5,000 for 100 ticks', () => {
    // Spend down to below $5,000
    // Starting cash: $75,000
    // Hire 5 drillers: 5 x $1,000 = $5,000
    for (let i = 0; i < 5; i++) {
      employeeCommand(ctx, ['hire'], { role: 'driller' });
    }

    // Build expensive buildings:
    // research_center T1: $25,000
    // management_office T1: $8,000
    // living_quarters T1: $10,000
    // freight_warehouse T1: $15,000
    // geology_lab T1: $12,000
    // Total buildings: $70,000
    // Total spent: $5,000 + $70,000 = $75,000 -> remaining $0
    //
    // Coordinates below are not the original (5,5)/(10,5)/(15,5)/(20,5)/
    // (25,5): #1008 wired a flatness check into the real placement path, and
    // most of those five spots sit on sloped ground on grumpstone_ridge's own
    // mountainous terrain (terrainSeed 2277) — an order refused there charges
    // nothing, so cash would never actually reach $0 and bankruptcy would
    // never trigger. These are the nearest flat, non-overlapping spots for
    // each building's own footprint ((10,5) happens to already be flat).
    buildCommand(ctx, ['research_center'], { at: '7,1' });
    buildCommand(ctx, ['management_office'], { at: '10,5' });
    buildCommand(ctx, ['living_quarters'], { at: '14,1' });
    buildCommand(ctx, ['freight_warehouse'], { at: '17,13' });
    buildCommand(ctx, ['geology_lab'], { at: '25,4' });

    // Verify cash is below $5,000
    expect(ctx.state!.cash).toBeLessThan(5000);

    // Tick 110 times (bankruptcy requires 100 ticks below threshold)
    tickWithEvents(ctx, 110);

    // Verify bankruptcy triggered
    expect(ctx.state!.bankruptcy.bankrupt).toBe(true);
    expect(ctx.state!.bankruptcy.ticksBelowThreshold).toBeGreaterThanOrEqual(100);

    // Verify the level itself ends, with the reason attributed to bankruptcy
    expect(ctx.state!.levelEnded).toBe(true);
    expect(ctx.state!.levelEndReason).toBe('bankruptcy');
  });
});
