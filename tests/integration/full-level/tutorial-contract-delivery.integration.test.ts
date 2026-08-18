// BlastSimulator2026 — Full-level integration test: Tutorial Contract Delivery
// Goal: Verify the full economy pipeline for issue #456 — a blast only spawns
// on-ground fragments (no instant cash/ore payout), a debris_hauler must
// physically haul a fragment into a freight_warehouse before it counts as
// collected/stored, and contract delivery is gated on that stored inventory
// rather than paying out unconditionally.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
  driveDrillPlanToCompletion,
  driveChargePlanToCompletion,
} from './helpers.js';
import { setupEvents, clearEvents } from '../../../src/core/events/index.js';
import { employeeCommand, buildCommand } from '../../../src/console/commands/entities.js';
import {
  surveyCommand,
  drillPlanCommand,
  chargeCommand,
  sequenceCommand,
  blastCommand,
} from '../../../src/console/commands/mining.js';
import { contractCommand } from '../../../src/console/commands/economy.js';
import { vehicleCommand } from '../../../src/console/commands/vehicle.js';
import { isOversized } from '../../../src/core/mining/BlastCalc.js';
import { findNearestReachableFragment } from '../../../src/core/economy/FragmentTaskLifecycle.js';

describe('Tutorial Level — Contract Delivery', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    clearEvents();
    setupEvents();
    ctx = makeCampaignCtx('tutorial_pit');
  });

  /**
   * Run the standard tutorial blast sequence and return the blast output,
   * plus the cash balance immediately before the blast itself (after hiring,
   * drilling, and charging — all of which legitimately spend cash on wages
   * and explosives, independent of the blast instant-payout shortcut #456
   * closes).
   */
  function executeTutorialBlast(): { output: string; cashBeforeBlast: number } {
    // Topped up (#553): this sequence now also crews a drill_rig ($35,000)
    // so drill_plan grid's queued drill_hole actions can actually land, and
    // setupHaulingFleet below crews a freight_warehouse + debris_hauler on
    // top of that — together more than tutorial_pit's $80,000 starting cash
    // covers. Every assertion here is relative (before/after), never against
    // an absolute cash figure, so this doesn't change what's being tested.
    ctx.state!.cash += 50_000;

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
    // Also driving.drill_rig, and a drill_rig vehicle to drive (#553):
    // drill_plan grid now queues one drill_hole PendingAction per hole
    // instead of writing them straight into state.drillHoles.
    employeeCommand(ctx, ['assign_skill', '2'], {
      skill: 'driving.drill_rig',
      level: '5',
    });
    const buyRig = vehicleCommand(ctx, ['buy', 'drill_rig'], {});
    expect(buyRig.success).toBe(true);

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
    driveDrillPlanToCompletion(ctx);

    // 5. Charge all holes with boomite 3kg/hole, stemming 2m
    const chargeResult = chargeCommand(ctx as any, [], {
      hole: '*',
      explosive: 'boomite',
      amount: '3kg',
      stemming: '2m',
    });
    expect(chargeResult.success).toBe(true);
    expect(chargeResult.output).toContain('Ordered charges');
    driveChargePlanToCompletion(ctx);

    // 6. Auto-sequence
    const seqResult = sequenceCommand(ctx as any, ['auto'], {});
    expect(seqResult.success).toBe(true);

    // 7. Blast
    const cashBeforeBlast = ctx.state!.cash;
    const blastResult = blastCommand(ctx as any, [], {});
    expect(blastResult.success).toBe(true);
    expect(blastResult.output).toContain('BLAST REPORT');

    return { output: blastResult.output, cashBeforeBlast };
  }

  /**
   * Hire+skill a hauler driver, buy a debris_hauler, assign the driver, tick
   * until the driver has boarded the vehicle, and only then build the
   * freight_warehouse. Returns the vehicle and driver IDs.
   *
   * Building the warehouse comes last, right before this function returns
   * with no tick in between — same reasoning as executeTutorialBlast's
   * drill_rig setup and economy.integration.test.ts's equivalent: self-
   * dispatch (#552) can only ever start a haul_debris workflow once an
   * active depot exists (requestHaulFragment's own depot check), so with no
   * depot yet the hauler simply stays idle/seated across the padding below
   * instead of auto-claiming the fragment this test's own manual haul step
   * (in each caller, immediately after this function returns) means to
   * exercise itself.
   */
  function setupHaulingFleet(): { vehicleId: number; driverId: number } {
    const hireDriver = employeeCommand(ctx, ['hire'], { role: 'driver' });
    expect(hireDriver.success).toBe(true);
    const driverId = ctx.state!.employees.employees.find(e => e.role === 'driver')!.id;
    employeeCommand(ctx, ['assign_skill', String(driverId)], {
      skill: 'driving.truck',
      level: '5',
    });

    const buyResult = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(buyResult.success).toBe(true);
    // find (not [0]) — executeTutorialBlast already purchased a drill_rig.
    const vehicleId = ctx.state!.vehicles.vehicles.find(v => v.type === 'debris_hauler')!.id;

    const assignResult = vehicleCommand(ctx, ['driver', String(vehicleId), String(driverId)], {});
    expect(assignResult.success).toBe(true);

    // Padding: let the driver walk to and board the vehicle.
    tickWithEvents(ctx, 10);

    // (9,13), near the drill site rather than the old (5,5): bigger levels
    // (#458 T6.1/D13) carry far more natural terrain relief than the old
    // ones, fragmenting NavGrid bench levels into small pockets more often.
    // (5,5) sat on a different bench than the drill/fragment area with no
    // ramp connecting them close by, so a loaded hauler could never findPath
    // there — confirmed via direct reproduction (a vehicle stuck retrying a
    // <2-tile trip for 10+ ticks, findMultiLevelPath returning found:false
    // every time). Keeping pickup and drop-off on the same bench sidesteps
    // that pathfinding gap rather than attempting to fix it here — a deeper,
    // more general fix belongs to T6.2 (pathfinding at scale). Moved from
    // (13,13) to (9,13) (#553): this function now builds the warehouse after
    // the vehicle has already parked at the grid centre (16,16) rather than
    // before purchase — deliberately, to keep self-dispatch (#552) from
    // racing this test's own manual haul step — and (13,13)'s 4×4 footprint
    // reaches exactly that corner, trapping the parked vehicle inside its own
    // now-blocked tile (NavGrid.computeReachableSet from (16,16) returns
    // empty). (9,13) is on the same bench without touching (16,16).
    const buildResult = buildCommand(ctx, ['freight_warehouse'], { at: '9,13' });
    expect(buildResult.success).toBe(true);

    return { vehicleId, driverId };
  }

  /**
   * Haul a single fragment from the ground into the warehouse and tick until
   * delivery completes (pickup leg + haul-to-warehouse leg).
   */
  function haulFragmentToStorage(vehicleId: number, fragmentId: number): void {
    const haulResult = vehicleCommand(ctx, ['haul', String(vehicleId)], {
      fragment: String(fragmentId),
    });
    expect(haulResult.success).toBe(true);

    // Tick until delivered rather than a flat padding count (#553): the
    // drill site and fragment field sit wherever the grid landed relative to
    // the depot, so the ticks a haul actually needs vary — and one caller
    // (the deadline-sensitive contract-delivery test) accepts a contract
    // whose deadlineTicks (30-100, Contract.ts's generateContracts) a fixed,
    // always-spent 100-tick pad could run past even after delivery finished
    // long before that. Capped generously above what any same-map haul needs.
    const tracked = (): { state: string } | undefined =>
      ctx.state!.logistics.fragments.find(f => f.fragment.id === fragmentId);
    for (let i = 0; i < 150 && tracked()?.state !== 'stored'; i++) {
      tickWithEvents(ctx, 1);
    }

    expect(tracked()?.state).toBe('stored');
  }

  // ── (a) Blast shortcut is closed: no instant cash/ore payout ─────────────

  it('a blast only spawns on-ground fragments — cash and collectedOre stay unchanged until hauled', () => {
    const collectedOreBefore = { ...ctx.state!.collectedOre };
    const fragmentsBefore = ctx.state!.logistics.fragments.length;

    const { cashBeforeBlast } = executeTutorialBlast();

    // No instant payout: cash right before the blast is unchanged after it
    // (hiring, drilling, and charging spend cash — that's expected — but the
    // blast itself must not credit anything).
    expect(ctx.state!.cash).toBe(cashBeforeBlast);
    // collectedOre is byte-identical (deep equal) to its pre-blast value —
    // a blast alone must not populate it.
    expect(ctx.state!.collectedOre).toEqual(collectedOreBefore);

    // The blast still spawns fragments — they just sit on the ground.
    expect(ctx.state!.logistics.fragments.length).toBeGreaterThan(fragmentsBefore);
    const onGround = ctx.state!.logistics.fragments.filter(f => f.state === 'on_ground');
    expect(onGround.length).toBe(ctx.state!.logistics.fragments.length);
    // Nothing has reached storage yet.
    expect(ctx.state!.logistics.storedMassKg).toBe(0);
  });

  // ── (c) Contract delivery before hauling fails on inventory ──────────────

  it('contract deliver immediately after the blast fails with an inventory error and leaves cash untouched', () => {
    executeTutorialBlast();
    tickWithEvents(ctx, 2);

    const cashBefore = ctx.state!.cash;

    // Contract #1 in the tutorial's deterministic contract set is a
    // rubble_disposal contract (materialId '') — draws from storedMassKg,
    // which is still 0 because nothing has been hauled into a warehouse yet.
    const acceptResult = contractCommand(ctx, ['accept', '1'], {});
    expect(acceptResult.success).toBe(true);

    const deliverResult = contractCommand(ctx, ['deliver', '1'], { amount: '200' });

    expect(deliverResult.success).toBe(false);
    expect(deliverResult.output).not.toContain('Payment: $');
    expect(deliverResult.output.length).toBeGreaterThan(0);
    // Failure must not touch cash or finances.
    expect(ctx.state!.cash).toBe(cashBefore);
  });

  // ── (b) Full haul-and-store loop (regression coverage for #437 wiring) ───

  it('a full haul-and-store cycle moves a blast fragment into warehouse storage', () => {
    executeTutorialBlast();
    const { vehicleId } = setupHaulingFleet();

    const collectedOreBeforeHaul = Object.values(ctx.state!.collectedOre).reduce((s, v) => s + v, 0);
    expect(ctx.state!.logistics.storedMassKg).toBe(0);

    // Haul a fragment that actually carries ore. Ore sits in veins, so only
    // some of a blast's fragments hold any — which one that is depends on
    // where the veins run, not on anything this test is asserting. Routed
    // through findNearestReachableFragment (#553, mirrors
    // economy.integration.test.ts's "full economy loop" case) rather than a
    // plain array .find(): the drill site now sits wherever the plan landed
    // relative to the depot, and an unreachable or oversized pick would fail
    // this test for a reason unrelated to what it means to exercise.
    const vehicle = ctx.state!.vehicles.vehicles.find(v => v.id === vehicleId)!;
    const oreBearingId = findNearestReachableFragment(ctx.state!, vehicleId, vehicle.x, vehicle.z, tracked =>
      !isOversized(tracked.fragment.volume) && Object.values(tracked.fragment.oreDensities).some(d => d > 0),
    );
    expect(oreBearingId, 'blast produced no reachable ore-bearing fragment to haul').not.toBeNull();

    haulFragmentToStorage(vehicleId, oreBearingId!);

    // Storage now holds the hauled fragment's mass.
    expect(ctx.state!.logistics.storedMassKg).toBeGreaterThan(0);

    // Ore collected from the actually-stored fragment now counts.
    const collectedOreAfterHaul = Object.values(ctx.state!.collectedOre).reduce((s, v) => s + v, 0);
    expect(collectedOreAfterHaul).toBeGreaterThan(collectedOreBeforeHaul);
  });

  // ── (d) Contract delivery after haul-and-store succeeds ───────────────────

  it('contract deliver after the haul-and-store cycle succeeds, decrements storage, and pays out', () => {
    executeTutorialBlast();

    // Accept contract #1 right after the blast (#553), before the haul
    // padding below — drilling plus a full haul-and-store cycle now spans
    // well over a hundred ticks, long enough to run past contract #1's own
    // deadlineTicks (30-100, Contract.ts's generateContracts) if accepted
    // only afterward, same as the pre-#553 version of this test did.
    // Accepting reserves the contract; it doesn't require inventory yet.
    const acceptResult = contractCommand(ctx, ['accept', '1'], {});
    expect(acceptResult.success).toBe(true);

    const { vehicleId } = setupHaulingFleet();
    // rubble_disposal (materialId '') doesn't care which fragment, only that
    // it's haulable and reachable — routed through findNearestReachableFragment
    // (#553, see the equivalent selection above) rather than a hardcoded
    // id:0, which was reachable before the drilling delay shifted where the
    // fleet ends up relative to the fragment field, but is not guaranteed to
    // stay so.
    const vehicle = ctx.state!.vehicles.vehicles.find(v => v.id === vehicleId)!;
    const haulableId = findNearestReachableFragment(ctx.state!, vehicleId, vehicle.x, vehicle.z, tracked =>
      !isOversized(tracked.fragment.volume),
    );
    expect(haulableId, 'blast produced no reachable haulable (non-oversized) fragment').not.toBeNull();
    haulFragmentToStorage(vehicleId, haulableId!);

    const storedBefore = ctx.state!.logistics.storedMassKg;
    expect(storedBefore).toBeGreaterThan(0);
    const cashBefore = ctx.state!.cash;

    // Contract #1 is rubble_disposal (materialId '') — deliver an amount well
    // within what was actually hauled into storage.
    const deliverAmount = Math.min(200, storedBefore);
    const deliverResult = contractCommand(ctx, ['deliver', '1'], {
      amount: String(deliverAmount),
    });

    expect(deliverResult.success).toBe(true);
    expect(deliverResult.output).toContain('Payment: $');
    const match = deliverResult.output.match(/Payment: \$(\d+(?:\.\d+)?)/);
    expect(match).not.toBeNull();
    const payment = parseFloat(match![1]!);
    expect(payment).toBeGreaterThan(0);

    // Cash increased by the delivery.
    expect(ctx.state!.cash).toBeGreaterThan(cashBefore);
    // Storage decreased — material actually consumed from the warehouse.
    expect(ctx.state!.logistics.storedMassKg).toBeLessThan(storedBefore);
  });
});
