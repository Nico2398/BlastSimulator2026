// BlastSimulator2026 — Full-level integration test: Tutorial Level
// Goal: Start tutorial_pit, execute full tutorial sequence (survey, blast,
// event, contracts, vehicles, buildings, policies), and verify completion.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
  driveDrillPlanToCompletion,
  driveChargePlanToCompletion,
  driveConstructionToCompletion,
  driveToLevelCompletion,
  assertLevelCompletion,
  assertStateSummaryCompletion,
} from './helpers.js';
import { setupEvents, clearEvents } from '../../../src/core/events/index.js';
import { timeCommand, eventCommand } from '../../../src/console/commands/events.js';
import { employeeCommand, buildCommand } from '../../../src/console/commands/entities.js';
import { surveyCommand, drillPlanCommand, chargeCommand, sequenceCommand, blastCommand, buildRampCommand } from '../../../src/console/commands/mining.js';
import { contractCommand } from '../../../src/console/commands/economy.js';
import { vehicleCommand } from '../../../src/console/commands/vehicle.js';
import { setPolicyCommand } from '../../../src/console/commands/policy.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import { pickupFragment, deliverToDepot } from '../../../src/core/economy/Logistics.js';
import { createGameEngine } from '../../../scripts/shared/command-runner.js';
import { runCommand } from '../../../src/console/createRunner.js';
import { countNavCellsByType } from '../../../src/ui/tutorialStepHelpers.js';

/** Starting cash comes from the level catalogue, not a copy of it. */
const TUTORIAL_START_CASH = getLevel('tutorial_pit')!.startingCash;

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
    expect(ctx.state!.cash).toBe(TUTORIAL_START_CASH);
    expect(ctx.state!.campaign.activeLevelId).toBe('tutorial_pit');
    // Verify grid dimensions: tutorial_pit = 32x20x32 (#458 T6.1/D13)
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.sizeX).toBe(32);
    expect(ctx.grid!.sizeY).toBe(20);
    expect(ctx.grid!.sizeZ).toBe(32);
    // No employees initially
    expect(ctx.state!.employees.employees.length).toBe(0);
    // No buildings
    expect(ctx.state!.buildings.buildings.length).toBe(0);
  });

  it('executes full tutorial sequence', () => {
    // Topped up (#553): this sequence now also crews a drill_rig ($35,000)
    // so drill_plan grid's queued drill_hole actions can actually land, on
    // top of everything it already spends (survey, charges, hires, a
    // debris_hauler) — plus payroll/upkeep across however many ticks the
    // drill takes. Nothing here asserts anything about an absolute cash
    // figure.
    ctx.state!.cash += 50_000;

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

    // 6b. Also driving.drill_rig, and a drill_rig vehicle to drive (#553):
    // drill_plan grid now queues one drill_hole PendingAction per hole
    // instead of writing them straight into state.drillHoles.
    employeeCommand(ctx, ['assign_skill', '2'], {
      skill: 'driving.drill_rig',
      level: '5',
    });
    const buyRig = vehicleCommand(ctx, ['buy', 'drill_rig'], {});
    expect(buyRig.success).toBe(true);

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
    driveDrillPlanToCompletion(ctx);

    // 8. Charge all holes with boomite
    const chargeResult = chargeCommand(ctx as any, [], {
      hole: '*',
      explosive: 'boomite',
      amount: '5kg',
      stemming: '2m',
    });
    expect(chargeResult.success).toBe(true);
    expect(chargeResult.output).toContain('Ordered charges');
    driveChargePlanToCompletion(ctx);

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

    // 16. Accept a contract for whichever ore this blast actually produced
    // the most of, among what's currently on offer. Not hardcoded to id 1
    // (#554): charging now takes real time, and the extra ticks
    // driveChargePlanToCompletion spends draining the charge orders above
    // are enough for the deadline-driven contract pool to cycle #1 out
    // before this step runs — and the contract that replaces it is drawn
    // from the full material catalog, not necessarily an ore this blast
    // yielded at all (the dominant ore, dirtite at this seed, is common
    // enough to not always be on offer itself). Ranking by yield rather than
    // taking the first match still matters for step 22 below: storage is
    // capacity-capped, so a contract for a barely-mined trace ore could
    // still fail delivery even once matched to *some* mined material.
    const oreYields = ctx.state!.lastOreReport?.oreYields ?? {};
    const rankedByYield = [...ctx.state!.contracts.available]
      .filter(c => (oreYields[c.materialId] ?? 0) > 0)
      .sort((a, b) => (oreYields[b.materialId] ?? 0) - (oreYields[a.materialId] ?? 0));
    const availableContract = rankedByYield[0] ?? ctx.state!.contracts.available[0]!;
    const availableContractId = availableContract.id;
    const acceptContract = contractCommand(ctx, ['accept', String(availableContractId)], {});
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

    // 19. Buy a debris_hauler. Not asserting a total vehicle count (#553):
    // the drill_rig from step 6b physically drove to (and parked at) each
    // hole it drilled, inside the blast footprint — the blast at step 10
    // can destroy a vehicle standing on ground it clears (blastCommand),
    // same as it can kill an employee standing there, so the drill_rig's
    // survival isn't guaranteed. This only asserts the debris_hauler itself
    // exists.
    const buyVehicle = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(buyVehicle.success).toBe(true);
    const haulerId = ctx.state!.vehicles.vehicles.find(v => v.type === 'debris_hauler')!.id;

    // 20. Assign driver #4 to the debris_hauler
    const assignDriver = vehicleCommand(ctx, ['driver', String(haulerId), '4'], {});
    expect(assignDriver.success).toBe(true);

    // 21. Build a freight_warehouse at (5,5). #556: confirming the order
    // only queues a construction site — drive it to completion (the
    // surveyor, idle since step 4, picks up the unskilled `place_building`
    // work) before asserting a real building exists.
    const buildResult = buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });
    expect(buildResult.success).toBe(true);
    expect(ctx.state!.buildings.buildings.length).toBe(0);
    driveConstructionToCompletion(ctx);
    expect(ctx.state!.buildings.buildings.length).toBe(1);

    // 22. Deliver to the accepted contract — should generate positive payment.
    // Ore must actually be in storage first (#456 — blasting alone no longer
    // credits cash/collectedOre; only hauled-and-stored fragments count).
    // Fragments are moved into storage via Logistics.pickupFragment/
    // deliverToDepot directly rather than driving the debris_hauler through
    // full NavGrid pathfinding — that vehicle-driving mechanism (#437) is
    // exercised by its own suites (HaulingTask.test.ts, ArrivalGate.test.ts);
    // these are the exact two primitives HaulingTask.tickHaulingProgress
    // calls internally on arrival.
    //
    // Every ground fragment is hauled (not stopped at a flat 500kg total),
    // and the delivery amount is capped to what's actually in storage for
    // the accepted contract's own material (#554): each fragment carries a
    // mixed oreDensities breakdown, not a single ore, and the fixed-id
    // contract this step used to hardcode happened to always be a
    // majority-share ore — dirtite, at this seed — so a flat 500kg of mixed
    // storage was always enough of it. The dynamic contract selection above
    // can now land on a minor-share ore (rustite et al.) instead, for which
    // 500kg of *total* stored mass is nowhere near 500kg of *that ore*.
    const groundFragments = ctx.state!.logistics.fragments.filter(f => f.state === 'on_ground');
    for (const f of groundFragments) {
      // A blast throws off boulders heavier than an early warehouse holds, and
      // pickupFragment turns those away — so count what actually landed in
      // storage rather than what was attempted.
      if (!pickupFragment(ctx.state!.logistics, f.fragment.id, 'vehicle-test')) continue;
      deliverToDepot(ctx.state!.logistics, f.fragment.id, ctx.state!.collectedOre);
    }
    expect(ctx.state!.logistics.storedMassKg).toBeGreaterThan(0);

    const deliverableKg = Math.min(500, ctx.state!.collectedOre[availableContract.materialId] ?? 0);
    expect(deliverableKg).toBeGreaterThan(0);

    const deliverResult = contractCommand(ctx, ['deliver', String(availableContractId)], { amount: String(deliverableKg) });
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
    // Perform a blast first to have some activity, then force-complete the tutorial level
    const { blastOutput } = assertLevelCompletion(ctx, 3, 3);
    expect(blastOutput).toContain('BLAST REPORT');
  });

  it('state summary shows completion status after level ends', () => {
    const { completeResult } = driveToLevelCompletion(ctx, 5, 5);
    expect(completeResult.success).toBe(true);
    expect(completeResult.output).toContain('force-completed');
    assertStateSummaryCompletion(ctx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #928: single-gauge (fatigue) model — travel-drain fix performance pin.
//
// Before the fix, an employee walking to a claimed job billed the outbound
// leg at the 'working' tier and the walk back to rest at the 'idle' tier —
// asymmetric drain that (combined with ForceShiftRest.ts's proactive rest
// trigger firing mid-walk to an already-claimed job) produced extra
// interrupted walks and repeated re-claims during the box-cut ramp dig.
// Issue #928 measured the pre-fix box-cut completing in 114 ticks for this
// exact repro. With both fixes in place (symmetric 'traveling' tier +
// walk-survives-proactive-trigger guard), the same repro must complete in
// fewer ticks — no claimed segment gets interrupted and re-walked mid-dig.
// ─────────────────────────────────────────────────────────────────────────────
describe('box-cut ramp-dig performance (#928 travel-drain fix)', () => {
  const PRE_FIX_BASELINE_TICKS = 114;
  // Generous ceiling so a genuine regression (or a stall) fails loudly by
  // name ("did not complete") rather than by silently exhausting the loop
  // and asserting on a sentinel value that happens to look like a pass.
  const MAX_TICKS = 300;

  it('completes the box-cut ramp segment in fewer ticks than the pre-fix 114-tick baseline', () => {
    const engine = createGameEngine();

    expect(runCommand(engine, 'campaign start level:tutorial_pit staffed:true').success).toBe(true);
    expect(runCommand(engine, 'build living_quarters at:18,14').success).toBe(true);
    expect(runCommand(engine, 'tick 40').success).toBe(true);
    expect(runCommand(engine, 'set_policy mode:continuous').success).toBe(true);
    expect(runCommand(engine, 'build_ramp start:16,19 end:16,31 depth:8').success).toBe(true);

    const state = engine.ctx.state!;
    const prevRampCount = state.navGrid ? countNavCellsByType(state.navGrid.cells, 'ramp') : 0;

    let ticksToComplete = -1;
    for (let i = 0; i < MAX_TICKS; i++) {
      runCommand(engine, 'tick 1');
      if (state.events.pendingEvent) {
        runCommand(engine, 'event choose 0');
      }
      const current = state.navGrid ? countNavCellsByType(state.navGrid.cells, 'ramp') : 0;
      if (current > prevRampCount) {
        ticksToComplete = i + 1;
        break;
      }
    }

    // The box-cut must actually complete within the budget — a stall is a
    // distinct failure from "too slow", and this assertion names it.
    expect(ticksToComplete).toBeGreaterThan(0);
    expect(ticksToComplete).toBeLessThan(PRE_FIX_BASELINE_TICKS);
  });
});
