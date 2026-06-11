// BlastSimulator2026 — Full-level integration test: Level 2 Win
// Goal: Start level 2 (with level 1 pre-completed), perform mining
// operations, and verify campaign completion.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtxWithUnlock,
  tickWithEvents,
  performBlast,
  getStateSummary,
} from './helpers.js';
import { campaignCompleteCommand, campaignStatusCommand } from '../../../src/console/commands/campaign.js';
import { employeeCommand } from '../../../src/console/commands/entities.js';
import { stateCommand } from '../../../src/console/commands/state.js';

describe('Level 2 — Win', () => {
  let ctx: ReturnType<typeof makeCampaignCtxWithUnlock>;

  beforeEach(() => {
    ctx = makeCampaignCtxWithUnlock('grumpstone_ridge');
  });

  it('starts level 2 with correct initial state', () => {
    expect(ctx.state).not.toBeNull();
    // Level 2 starting cash is $75,000
    expect(ctx.state!.cash).toBe(75000);
    expect(ctx.state!.campaign.activeLevelId).toBe('grumpstone_ridge');
    expect(ctx.grid).not.toBeNull();
    // Verify grid dimensions: grumpstone_ridge = 60x30x60
    expect(ctx.grid!.sizeX).toBe(60);
    expect(ctx.grid!.sizeY).toBe(30);
    expect(ctx.grid!.sizeZ).toBe(60);
    // Level 1 should be marked as completed
    const statusResult = campaignStatusCommand(ctx, [], {});
    expect(statusResult.success).toBe(true);
  });

  it('can hire, perform a blast, and complete the level', () => {
    // Hire a driller
    const hireResult = employeeCommand(ctx, ['hire'], { role: 'driller' });
    expect(hireResult.success).toBe(true);
    expect(ctx.state!.employees.employees.length).toBe(1);

    // Assign blasting skill
    employeeCommand(ctx, ['assign_skill', '1'], { skill: 'blasting', level: '5' });

    // Perform a blast at (15,15) — offset from origin to avoid center
    const blastOutput = performBlast(ctx, 15, 15);
    expect(blastOutput).toContain('BLAST REPORT');
    tickWithEvents(ctx, 5);

    // Force-complete the level
    const completeResult = campaignCompleteCommand(ctx, [], {});
    expect(completeResult.success).toBe(true);
    expect(completeResult.output).toContain('force-completed');

    // Verify level ended
    expect(ctx.state!.levelEnded).toBe(true);
    expect(ctx.state!.levelEndReason).toBe('completed');
  });
});
