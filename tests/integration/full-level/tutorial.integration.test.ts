// BlastSimulator2026 — Full-level integration test: Tutorial Level
// Goal: Start tutorial_pit, execute full tutorial sequence (survey, blast,
// event, contracts, vehicles, buildings, policies), and verify completion.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
  performBlast,
  getStateSummary,
} from './helpers.js';
import { setupEvents, clearEvents } from '../../../src/core/events/index.js';
import { campaignCompleteCommand } from '../../../src/console/commands/campaign.js';
import { timeCommand, tickCommand, eventCommand } from '../../../src/console/commands/events.js';
import { employeeCommand, buildCommand } from '../../../src/console/commands/entities.js';
import { surveyCommand, drillPlanCommand, chargeCommand, sequenceCommand, blastCommand, buildRampCommand } from '../../../src/console/commands/mining.js';
import { contractCommand } from '../../../src/console/commands/economy.js';
import { vehicleCommand } from '../../../src/console/commands/vehicle.js';
import { setPolicyCommand } from '../../../src/console/commands/policy.js';
import { stateCommand } from '../../../src/console/commands/state.js';

describe('Tutorial Level — Full Walkthrough', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    clearEvents();
    setupEvents();
    ctx = makeCampaignCtx('tutorial_pit');
  });

  it('sets up tutorial_pit with correct initial state', () => {
    expect(ctx.state).not.toBeNull();
    // startingCash from Level definition
    expect(ctx.state!.cash).toBe(20000);
    expect(ctx.state!.campaign.activeLevelId).toBe('tutorial_pit');
    // Verify grid dimensions: tutorial_pit = 24x12x24
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.sizeX).toBe(24);
    expect(ctx.grid!.sizeY).toBe(12);
    expect(ctx.grid!.sizeZ).toBe(24);
    // No employees initially
    expect(ctx.state!.employees.employees.length).toBe(0);
    // No buildings
    expect(ctx.state!.buildings.buildings.length).toBe(0);
  });

  it('executes full tutorial sequence', () => {
    // 1. Set game speed to 2x
    const speedResult = timeCommand(ctx, ['speed', '2'], {});
    expect(speedResult.success).toBe(true);
    expect(ctx.state!.timeScale).toBe(2);

    // 2. Hire a surveyor (ID=1)
    const hireSurveyor = employeeCommand(ctx, ['hire'], { role: 'surveyor' });
    expect(hireSurveyor.success).toBe(true);
    expect(hireSurveyor.output).toContain('Hired');
    expect(ctx.state!.employees.employees.length).toBe(1);

    // 3. Assign geology skill level 5
    const assignGeo = employeeCommand(ctx, ['assign_skill', '1'], {
      skill: 'geology',
      level: '5',
    });
    expect(assignGeo.success).toBe(true);
    expect(assignGeo.output).toContain('assigned skill');

    // 4. Perform a seismic survey at (12,12)
    const surveyResult = surveyCommand(ctx as any, ['seismic'], { x: '12', z: '12' });
    expect(surveyResult.success).toBe(true);

    // 5. Hire a driller (ID=2)
    const hireDriller = employeeCommand(ctx, ['hire'], { role: 'driller' });
    expect(hireDriller.success).toBe(true);
    expect(hireDriller.output).toContain('Hired');
    expect(ctx.state!.employees.employees.length).toBe(2);

    // 6. Assign blasting skill level 5
    const assignBlast = employeeCommand(ctx, ['assign_skill', '2'], {
      skill: 'blasting',
      level: '5',
    });
    expect(assignBlast.success).toBe(true);
    expect(assignBlast.output).toContain('assigned skill');

    // 7. Create a drill plan: 2×2 grid at (10,10), 4m spacing, 8m depth
    const drillResult = drillPlanCommand(ctx as any, ['grid'], {
      origin: '10,10',
      rows: '2',
      cols: '2',
      spacing: '4',
      depth: '8',
    });
    expect(drillResult.success).toBe(true);
    expect(drillResult.output).toContain('4 holes');

    // 8. Charge all holes with boomite
    const chargeResult = chargeCommand(ctx as any, [], {
      hole: '*',
      explosive: 'boomite',
      amount: '5kg',
      stemming: '2m',
    });
    expect(chargeResult.success).toBe(true);
    expect(chargeResult.output).toContain('Charged');

    // 9. Auto-sequence
    const seqResult = sequenceCommand(ctx as any, ['auto'], {});
    expect(seqResult.success).toBe(true);

    // 10. Blast — expect BLAST REPORT
    const blastResult = blastCommand(ctx as any, [], {});
    expect(blastResult.success).toBe(true);
    expect(blastResult.output).toContain('BLAST REPORT');

    // 11. Advance ticks to let blast settle and process any pending events
    tickWithEvents(ctx, 2);

    // 12. Fire the tutorial_synergy_consultant event
    const fireEvent = eventCommand(ctx, ['fire', 'tutorial_synergy_consultant'], {});
    expect(fireEvent.success).toBe(true);
    expect(fireEvent.output).toContain('EVENT');

    // 13. Choose option 0 to resolve the event
    const chooseEvent = eventCommand(ctx, ['choose', '0'], {});
    expect(chooseEvent.success).toBe(true);
    expect(chooseEvent.output).toContain('Event resolved');

    // 14. Hire a manager (ID=3)
    const hireManager = employeeCommand(ctx, ['hire'], { role: 'manager' });
    expect(hireManager.success).toBe(true);
    expect(hireManager.output).toContain('Hired');
    expect(ctx.state!.employees.employees.length).toBe(3);

    // 15. Assign management skill level 5
    const assignMgt = employeeCommand(ctx, ['assign_skill', '3'], {
      skill: 'management',
      level: '5',
    });
    expect(assignMgt.success).toBe(true);
    expect(assignMgt.output).toContain('assigned skill');

    // 16. Accept contract #1
    const acceptContract = contractCommand(ctx, ['accept', '1'], {});
    expect(acceptContract.success).toBe(true);
    expect(acceptContract.output).toContain('Accepted contract');

    // 17. Hire a driver (ID=4)
    const hireDriver = employeeCommand(ctx, ['hire'], { role: 'driver' });
    expect(hireDriver.success).toBe(true);
    expect(hireDriver.output).toContain('Hired');
    expect(ctx.state!.employees.employees.length).toBe(4);

    // 18. Assign driving.truck skill level 5
    const assignDrive = employeeCommand(ctx, ['assign_skill', '4'], {
      skill: 'driving.truck',
      level: '5',
    });
    expect(assignDrive.success).toBe(true);
    expect(assignDrive.output).toContain('assigned skill');

    // 19. Buy a debris_hauler (ID=1)
    const buyVehicle = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(buyVehicle.success).toBe(true);
    expect(ctx.state!.vehicles.vehicles.length).toBe(1);

    // 20. Assign driver #4 to vehicle #1
    const assignDriver = vehicleCommand(ctx, ['driver', '1', '4'], {});
    expect(assignDriver.success).toBe(true);

    // 21. Build a freight_warehouse at (5,5)
    const buildResult = buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });
    expect(buildResult.success).toBe(true);
    expect(ctx.state!.buildings.buildings.length).toBe(1);

    // 22. Deliver 500kg to contract #1 — should generate positive payment
    const deliverResult = contractCommand(ctx, ['deliver', '1'], { amount: '500' });
    expect(deliverResult.success).toBe(true);
    expect(deliverResult.output).toContain('Payment: $');
    // Payment should be positive (> 0)
    expect(deliverResult.output).not.toContain('Payment: $0');

    // 23. Build a ramp at (12,12) going south for 10m
    const rampResult = buildRampCommand(ctx as any, [], {
      origin: '12,12',
      direction: 'south',
      length: '10',
    });
    expect(rampResult.success).toBe(true);

    // 24. Set policy to 8-hour shifts
    const policyResult = setPolicyCommand(ctx, [], { mode: 'shift_8h' });
    expect(policyResult.success).toBe(true);
    expect(ctx.state!.sitePolicy.shiftMode).toBe('shift_8h');
  });

  it('completes the tutorial level', () => {
    // Perform a blast first to have some activity
    employeeCommand(ctx, ['hire'], { role: 'driller' });
    employeeCommand(ctx, ['assign_skill', '1'], { skill: 'blasting', level: '3' });
    const blastOutput = performBlast(ctx, 10, 10);
    expect(blastOutput).toContain('BLAST REPORT');
    tickWithEvents(ctx, 3);

    // Force-complete the tutorial level
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

  it('state summary shows completion status after level ends', () => {
    employeeCommand(ctx, ['hire'], { role: 'driller' });
    employeeCommand(ctx, ['assign_skill', '1'], { skill: 'blasting', level: '5' });
    performBlast(ctx, 10, 10);
    tickWithEvents(ctx, 5);

    // Force-complete
    const completeResult = campaignCompleteCommand(ctx, [], {});
    expect(completeResult.success).toBe(true);
    expect(completeResult.output).toContain('force-completed');

    // The state summary should reflect completion
    const statsResult = stateCommand(ctx as any, ['summary'], {});
    expect(statsResult.success).toBe(true);
    const parsed = JSON.parse(statsResult.output) as Record<string, unknown>;
    expect(parsed.levelEnded).toBe(true);
    expect(parsed.levelEndReason).toBe('completed');
  });
});
