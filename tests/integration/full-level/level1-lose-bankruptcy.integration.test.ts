// BlastSimulator2026 — Full-level integration test: Level 1 Lose — Bankruptcy
// Goal: Start level 1, drive cash to zero / max debt, and verify the
// bankruptcy:triggered event fires and the level ends in loss.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
} from './helpers.js';
import { employeeCommand } from '../../../src/console/commands/entities.js';
import { buildCommand } from '../../../src/console/commands/entities.js';

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
    // Spend money to drain cash below $5,000
    // Hire 5 drillers: 5 x $1,000 = $5,000
    for (let i = 0; i < 5; i++) {
      employeeCommand(ctx, ['hire'], { role: 'driller' });
    }

    // Build expensive buildings (T1 costs):
    // management_office: $8,000
    // research_center: $25,000
    // living_quarters: $10,000
    // freight_warehouse: $15,000
    // Total: $58,000 + $5,000 hiring = $63,000 > $50,000
    // Let's be more conservative to stay under $5k:
    // Already spent $5,000 on hiring. Cash = $45,000.
    // Build management_office ($8k) -> $37,000
    // Build research_center ($25k) -> $12,000
    // Build living_quarters ($10k) -> $2,000
    // That should be under $5k.

    buildCommand(ctx as any, ['management_office'], { at: '5,5' });
    buildCommand(ctx as any, ['research_center'], { at: '10,5' });
    buildCommand(ctx as any, ['living_quarters'], { at: '15,5' });

    // Verify cash is below $5,000
    expect(ctx.state!.cash).toBeLessThan(5000);

    // Tick 110 times (bankruptcy requires 100 ticks below threshold)
    tickWithEvents(ctx, 110);

    // Verify bankruptcy triggered
    expect(ctx.state!.bankruptcy.bankrupt).toBe(true);
    // ticksBelowThreshold may have accumulated some ticks before we hit 100,
    // but should be >= 100 by now
    expect(ctx.state!.bankruptcy.ticksBelowThreshold).toBeGreaterThanOrEqual(100);
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
  });
});
