// BlastSimulator2026 — Full-level integration test: Tutorial Contract Delivery
// Goal: Verify that a tutorial-level blast (2×2 grid, boomite 3 kg/hole) produces
// enough ore to deliver at least 200 kg of a contract, by tracking fragments
// through logistics and accumulating collectedOre from blast yields.
//
// RED phase — all tests fail because:
//   1. addBlastFragments is not yet called in blastCommand (line 14 of mining.ts)
//   2. state.collectedOre is never populated after blast
//   3. contract deliver does not check actual ore inventory

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
  getStateSummary,
} from './helpers.js';
import { setupEvents, clearEvents } from '../../../src/core/events/index.js';
import { employeeCommand } from '../../../src/console/commands/entities.js';
import {
  surveyCommand,
  drillPlanCommand,
  chargeCommand,
  sequenceCommand,
  blastCommand,
} from '../../../src/console/commands/mining.js';
import { contractCommand } from '../../../src/console/commands/economy.js';

describe('Tutorial Level — Contract Delivery', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    clearEvents();
    setupEvents();
    ctx = makeCampaignCtx('tutorial_pit');
  });

  /** Run the standard tutorial blast sequence and return the blast output. */
  function executeTutorialBlast(): string {
    // 1. Hire surveyor (ID=1) with geology skill
    const hireSurveyor = employeeCommand(ctx, ['hire'], { role: 'surveyor' });
    expect(hireSurveyor.success).toBe(true);
    employeeCommand(ctx, ['assign_skill', '1'], {
      skill: 'geology',
      level: '5',
    });

    // 2. Seismic survey at (12,12)
    const surveyResult = surveyCommand(ctx as any, ['seismic'], {
      x: '12',
      z: '12',
    });
    expect(surveyResult.success).toBe(true);

    // 3. Hire driller (ID=2) with blasting skill
    const hireDriller = employeeCommand(ctx, ['hire'], { role: 'driller' });
    expect(hireDriller.success).toBe(true);
    employeeCommand(ctx, ['assign_skill', '2'], {
      skill: 'blasting',
      level: '5',
    });

    // 4. Drill 2×2 grid at (10,10), 4m spacing, 8m depth
    const drillResult = drillPlanCommand(ctx as any, ['grid'], {
      origin: '10,10',
      rows: '2',
      cols: '2',
      spacing: '4',
      depth: '8',
    });
    expect(drillResult.success).toBe(true);
    expect(drillResult.output).toContain('4 holes');

    // 5. Charge all holes with boomite 3kg/hole, stemming 2m
    const chargeResult = chargeCommand(ctx as any, [], {
      hole: '*',
      explosive: 'boomite',
      amount: '3kg',
      stemming: '2m',
    });
    expect(chargeResult.success).toBe(true);
    expect(chargeResult.output).toContain('Charged');

    // 6. Auto-sequence
    const seqResult = sequenceCommand(ctx as any, ['auto'], {});
    expect(seqResult.success).toBe(true);

    // 7. Blast
    const blastResult = blastCommand(ctx as any, [], {});
    expect(blastResult.success).toBe(true);
    expect(blastResult.output).toContain('BLAST REPORT');

    return blastResult.output;
  }

  // ── Test 1: Fragments in logistics ────────────────────────────────────

  it('executes tutorial blast and tracks fragments in logistics', () => {
    executeTutorialBlast();

    // Verify blast produced a positive ore value
    const summary = getStateSummary(ctx);
    expect(summary.cash).toBeGreaterThan(20000); // startingCash + ore value

    // ── RED: These assertions fail because addBlastFragments is never called ──
    // After the implementer wires addBlastFragments into blastCommand,
    // logistics.fragments should contain entries from the blast.

    // Check that logistics fragments were populated by the blast
    expect(ctx.state!.logistics.fragments.length).toBeGreaterThan(0);
    // Every fragment should start as 'on_ground'
    const onGround = ctx.state!.logistics.fragments.filter(
      f => f.state === 'on_ground',
    );
    expect(onGround.length).toBe(ctx.state!.logistics.fragments.length);
  });

  // ── Test 2: Collected ore accumulation ────────────────────────────────

  it('accumulates collectedOre from blast fragments exceeds 200 kg', () => {
    executeTutorialBlast();

    // ── RED: These assertions fail because collectedOre is never populated ──
    // After the implementer wires fragment → depot delivery,
    // collectedOre should contain ore type keys with accumulated kg totals.

    // Verify collectedOre was populated from fragment ore content
    const oreKeys = Object.keys(ctx.state!.collectedOre);
    expect(oreKeys.length).toBeGreaterThan(0);

    // Total collected mass should exceed 200 kg (enough for contract delivery)
    const totalKg = Object.values(ctx.state!.collectedOre).reduce(
      (sum, v) => sum + v,
      0,
    );
    expect(totalKg).toBeGreaterThan(200);
  });

  // ── Test 3: Full contract delivery pipeline ───────────────────────────

  it('fulfills a 200 kg contract with blast ore', () => {
    executeTutorialBlast();

    // ── RED: This assertion fails because collectedOre is never populated ──
    const oreKeys = Object.keys(ctx.state!.collectedOre);
    expect(oreKeys.length).toBeGreaterThan(0);

    // Settle after blast
    tickWithEvents(ctx, 2);

    // Accept contract #1
    const acceptResult = contractCommand(ctx, ['accept', '1'], {});
    expect(acceptResult.success).toBe(true);
    expect(acceptResult.output).toContain('Accepted contract');

    // Deliver 200 kg to contract #1
    const deliverResult = contractCommand(ctx, ['deliver', '1'], {
      amount: '200',
    });
    expect(deliverResult.success).toBe(true);
    expect(deliverResult.output).toContain('Payment: $');
    // Payment must be positive — at minimum $1
    const match = deliverResult.output.match(/Payment: \$(\d+(?:\.\d+)?)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBeDefined();
    const payment = parseFloat(match![1]);
    expect(payment).toBeGreaterThan(0);

    // Collected ore should be decremented by delivered amount
    // (Implementer may deduct from collectedOre upon delivery)
    const totalAfterDelivery = Object.values(
      ctx.state!.collectedOre,
    ).reduce((sum, v) => sum + v, 0);
    // At minimum, collected ore should still be non-negative
    expect(totalAfterDelivery).toBeGreaterThanOrEqual(0);
  });
});
