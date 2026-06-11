// BlastSimulator2026 — Full-level integration test: Level 2 Lose — Bankruptcy
// Goal: Start level 2, drive cash to below $5,000, and verify the
// bankruptcy triggers after 100 consecutive ticks.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtxWithUnlock,
  tickWithEvents,
} from './helpers.js';
import { employeeCommand } from '../../../src/console/commands/entities.js';
import { buildCommand } from '../../../src/console/commands/entities.js';

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
    buildCommand(ctx as any, ['research_center'], { at: '5,5' });
    buildCommand(ctx as any, ['management_office'], { at: '10,5' });
    buildCommand(ctx as any, ['living_quarters'], { at: '15,5' });
    buildCommand(ctx as any, ['freight_warehouse'], { at: '20,5' });
    buildCommand(ctx as any, ['geology_lab'], { at: '25,5' });

    // Verify cash is below $5,000
    expect(ctx.state!.cash).toBeLessThan(5000);

    // Tick 110 times (bankruptcy requires 100 ticks below threshold)
    tickWithEvents(ctx, 110);

    // Verify bankruptcy triggered
    expect(ctx.state!.bankruptcy.bankrupt).toBe(true);
    expect(ctx.state!.bankruptcy.ticksBelowThreshold).toBeGreaterThanOrEqual(100);
  });
});
