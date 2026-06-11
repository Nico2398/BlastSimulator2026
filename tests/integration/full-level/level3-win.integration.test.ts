// BlastSimulator2026 — Full-level integration test: Level 3 Win
// Goal: Start level 3 (with levels 1-2 pre-completed), perform mining
// operations, and verify campaign completion.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtxWithUnlock,
  tickWithEvents,
  performBlast,
  getStateSummary,
} from './helpers.js';
import { campaignCompleteCommand } from '../../../src/console/commands/campaign.js';
import { employeeCommand } from '../../../src/console/commands/entities.js';

describe('Level 3 — Win', () => {
  let ctx: ReturnType<typeof makeCampaignCtxWithUnlock>;

  beforeEach(() => {
    ctx = makeCampaignCtxWithUnlock('treranium_depths');
  });

  it('starts level 3 with correct initial state', () => {
    expect(ctx.state).not.toBeNull();
    // Level 3 starting cash is $100,000
    expect(ctx.state!.cash).toBe(100000);
    expect(ctx.state!.campaign.activeLevelId).toBe('treranium_depths');
    expect(ctx.grid).not.toBeNull();
    // Verify grid dimensions: treranium_depths = 80x40x80
    expect(ctx.grid!.sizeX).toBe(80);
    expect(ctx.grid!.sizeY).toBe(40);
    expect(ctx.grid!.sizeZ).toBe(80);
  });

  it('can hire, perform a blast, and complete the level', () => {
    // Hire a driller
    const hireResult = employeeCommand(ctx, ['hire'], { role: 'driller' });
    expect(hireResult.success).toBe(true);
    expect(ctx.state!.employees.employees.length).toBe(1);

    // Assign blasting skill
    employeeCommand(ctx, ['assign_skill', '1'], { skill: 'blasting', level: '5' });

    // Perform a blast at (30,30) — offset from origin
    const blastOutput = performBlast(ctx, 30, 30);
    expect(blastOutput).toContain('BLAST REPORT');
    tickWithEvents(ctx, 5);

    // Force-complete the level
    const completeResult = campaignCompleteCommand(ctx, [], {});
    expect(completeResult.success).toBe(true);
    expect(completeResult.output).toContain('force-completed');

    // Verify level ended
    expect(ctx.state!.levelEnded).toBe(true);
    expect(ctx.state!.levelEndReason).toBe('completed');

    // Verify state summary reflects completion
    const summary = getStateSummary(ctx);
    expect(summary.levelEnded).toBe(true);
    expect(summary.levelEndReason).toBe('completed');
  });
});
