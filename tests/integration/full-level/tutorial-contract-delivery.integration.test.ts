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

  /**
   * Hire+skill a hauler driver, build a freight_warehouse, buy a
   * debris_hauler, assign the driver, and tick until the driver has boarded
   * the vehicle. Returns the vehicle and driver IDs.
   */
  function setupHaulingFleet(): { vehicleId: number; driverId: number } {
    const hireDriver = employeeCommand(ctx, ['hire'], { role: 'driver' });
    expect(hireDriver.success).toBe(true);
    const driverId = ctx.state!.employees.employees.find(e => e.role === 'driver')!.id;
    employeeCommand(ctx, ['assign_skill', String(driverId)], {
      skill: 'driving.truck',
      level: '5',
    });

    const buildResult = buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });
    expect(buildResult.success).toBe(true);

    const buyResult = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(buyResult.success).toBe(true);
    const vehicleId = ctx.state!.vehicles.vehicles[0]!.id;

    const assignResult = vehicleCommand(ctx, ['driver', String(vehicleId), String(driverId)], {});
    expect(assignResult.success).toBe(true);

    // Padding: let the driver walk to and board the vehicle.
    tickWithEvents(ctx, 10);

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

    // Padding: pickup + travel to the depot, well beyond what a same-map
    // haul needs (mirrors the tick-padding convention used elsewhere for
    // arrival-gated actions).
    tickWithEvents(ctx, 30);

    const tracked = ctx.state!.logistics.fragments.find(f => f.fragment.id === fragmentId);
    expect(tracked?.state).toBe('stored');
  }

  // ── (a) Blast shortcut is closed: no instant cash/ore payout ─────────────

  it('a blast only spawns on-ground fragments — cash and collectedOre stay unchanged until hauled', () => {
    const cashBefore = ctx.state!.cash;
    const collectedOreBefore = { ...ctx.state!.collectedOre };
    const fragmentsBefore = ctx.state!.logistics.fragments.length;

    executeTutorialBlast();

    // No instant payout: cash is byte-identical to its pre-blast value.
    expect(ctx.state!.cash).toBe(cashBefore);
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

    haulFragmentToStorage(vehicleId, 0);

    // Storage now holds the hauled fragment's mass.
    expect(ctx.state!.logistics.storedMassKg).toBeGreaterThan(0);

    // Ore collected from the actually-stored fragment now counts.
    const collectedOreAfterHaul = Object.values(ctx.state!.collectedOre).reduce((s, v) => s + v, 0);
    expect(collectedOreAfterHaul).toBeGreaterThan(collectedOreBeforeHaul);
  });

  // ── (d) Contract delivery after haul-and-store succeeds ───────────────────

  it('contract deliver after the haul-and-store cycle succeeds, decrements storage, and pays out', () => {
    executeTutorialBlast();
    const { vehicleId } = setupHaulingFleet();
    haulFragmentToStorage(vehicleId, 0);

    const storedBefore = ctx.state!.logistics.storedMassKg;
    expect(storedBefore).toBeGreaterThan(0);
    const cashBefore = ctx.state!.cash;

    const acceptResult = contractCommand(ctx, ['accept', '1'], {});
    expect(acceptResult.success).toBe(true);

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
