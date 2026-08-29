// BlastSimulator2026 — Full-level integration test: Level 1 Win
// Goal: Start level 1, perform mining operations, accumulate profit past
// the unlock threshold, and verify campaign completion.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
  performBlast,
  driveToLevelCompletion,
  assertLevelCompletion,
  assertStateSummaryCompletion,
} from './helpers.js';
import { employeeCommand } from '../../../src/console/commands/entities.js';

describe('Level 1 — Win', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    ctx = makeCampaignCtx('dusty_hollow');
  });

  it('starts level 1 with correct initial state', () => {
    expect(ctx.state).not.toBeNull();
    expect(ctx.state!.cash).toBe(50000);
    expect(ctx.state!.campaign.activeLevelId).toBe('dusty_hollow');
    // Verify grid dimensions: dusty_hollow = 96x40x96 (#458 T6.1/D13)
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.sizeX).toBe(96);
    expect(ctx.grid!.sizeY).toBe(40);
    expect(ctx.grid!.sizeZ).toBe(96);
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
    // Perform a blast first to have some activity, then force-complete the level
    assertLevelCompletion(ctx, 3, 3);
  });

  it('level can reach star rating display after completion', () => {
    driveToLevelCompletion(ctx, 5, 5);
    assertStateSummaryCompletion(ctx);
  });
});
