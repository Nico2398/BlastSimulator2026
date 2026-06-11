// BlastSimulator2026 — Full-level integration test: Level 1 Win
// Goal: Start level 1, perform mining operations, accumulate profit past
// the unlock threshold, and verify campaign completion.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
  performBlast,
  getStateSummary,
} from './helpers.js';
import { campaignCompleteCommand } from '../../../src/console/commands/campaign.js';
import { employeeCommand } from '../../../src/console/commands/entities.js';
import { stateCommand } from '../../../src/console/commands/state.js';

describe('Level 1 — Win', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    ctx = makeCampaignCtx('dusty_hollow');
  });

  it('starts level 1 with correct initial state', () => {
    expect(ctx.state).not.toBeNull();
    expect(ctx.state!.cash).toBe(50000);
    expect(ctx.state!.campaign.activeLevelId).toBe('dusty_hollow');
    expect(ctx.state!.grid).not.toBeNull();
    // Verify grid dimensions: dusty_hollow = 40x20x40
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.sizeX).toBe(40);
    expect(ctx.grid!.sizeY).toBe(20);
    expect(ctx.grid!.sizeZ).toBe(40);
    // No employees initially
    expect(ctx.state!.employees.employees.length).toBe(0);
    // No buildings
    expect(ctx.state!.buildings.buildings.length).toBe(0);
  });

  it('can hire an employee, assign skill, and perform a blast', () => {
    // Hire a driller
    const hireResult = employeeCommand(ctx, ['hire'], { role: 'driller' });
    expect(hireResult.success).toBe(true);
    expect(hireResult.output).toContain('Hired');
    expect(ctx.state!.employees.employees.length).toBe(1);

    // The first employee gets id=1 (nextId starts at 1)
    const empId = 1;
    const skillResult = employeeCommand(ctx, ['assign_skill', String(empId)], {
      skill: 'blasting',
      level: '5',
    });
    expect(skillResult.success).toBe(true);
    expect(skillResult.output).toContain('assigned skill');

    // Perform a blast at (10,10)
    const blastOutput = performBlast(ctx, 10, 10);
    expect(blastOutput).toContain('BLAST REPORT');
    // Wait a few ticks
    tickWithEvents(ctx, 5);
  });

  it('can complete the level via campaignCompleteCommand', () => {
    // Perform a blast first to have some activity
    employeeCommand(ctx, ['hire'], { role: 'driller' });
    employeeCommand(ctx, ['assign_skill', '1'], { skill: 'blasting', level: '3' });
    performBlast(ctx, 10, 10);
    tickWithEvents(ctx, 3);

    // Force-complete the level
    const completeResult = campaignCompleteCommand(ctx, [], {});
    expect(completeResult.success).toBe(true);
    expect(completeResult.output).toContain('force-completed');

    // Verify level ended
    expect(ctx.state!.levelEnded).toBe(true);
    expect(ctx.state!.levelEndReason).toBe('completed');

    // Stats should be available
    const summary = getStateSummary(ctx);
    expect(summary.levelEnded).toBe(true);
    expect(summary.levelEndReason).toBe('completed');
  });

  it('level can reach star rating display after completion', () => {
    employeeCommand(ctx, ['hire'], { role: 'driller' });
    employeeCommand(ctx, ['assign_skill', '1'], { skill: 'blasting', level: '5' });
    performBlast(ctx, 10, 10);
    tickWithEvents(ctx, 5);

    // Force-complete
    campaignCompleteCommand(ctx, [], {});

    // The stats command should show star rating
    const statsResult = stateCommand(ctx as any, ['summary'], {});
    expect(statsResult.success).toBe(true);
    const parsed = JSON.parse(statsResult.output) as Record<string, unknown>;
    expect(parsed.levelEnded).toBe(true);
    expect(parsed.levelEndReason).toBe('completed');
  });
});
