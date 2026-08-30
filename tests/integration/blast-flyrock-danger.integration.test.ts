// BlastSimulator2026 — Flyrock is dangerous, and stemming is the defence.
//
// The whole point of the blast pipeline is that a bad plan hurts. These drive
// the real console commands end to end and check that thrown rock reaches
// people and machines standing where it lands — and that stemming the holes
// properly is what stops it.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  blastCommand,
  drillPlanCommand,
  chargeCommand,
  sequenceCommand,
  type MiningContext,
} from '../../src/console/commands/mining.js';
import { resetHoleIds } from '../../src/core/mining/DrillPlan.js';
import { hireEmployee } from '../../src/core/entities/Employee.js';
import { Random } from '../../src/core/math/Random.js';
import { purchaseVehicle } from '../../src/core/entities/Vehicle.js';
import { placeBuilding } from '../../src/core/entities/Building.js';
import { computeDangerZone, isInZone } from '../../src/core/entities/Zone.js';
import { BLAST_DANGER_MARGIN_M } from '../../src/core/config/balance.js';
import { tickCommand } from '../../src/console/commands/events.js';
import { makeGameContext } from '../helpers/gameContext.js';

function makeCtx(): MiningContext {
  // Staffed (#553): drill_plan grid now queues one drill_hole PendingAction
  // per hole instead of writing them straight into state.drillHoles — a
  // 'blasting'-qualified employee and a drill_rig vehicle are needed for any
  // hole to actually land.
  return makeGameContext({ mineType: 'desert', seed: 42, size: 48, staffed: true });
}

/**
 * Ticks until every hole ordered by the last drill_plan grid has landed in
 * state.drillHoles (#553). Tops up employee need gauges each tick — this
 * file's staffed site is a single drill_rig/driller, and a multi-hole plan
 * can run long enough for hunger/fatigue/breakNeed to cross a collapse
 * threshold mid-drive, an unrelated needs mechanic these tests aren't
 * exercising.
 *
 * Relocates the staffed driller (employee #1) well clear of the pattern once
 * drilling finishes. Driving never used to move an employee's own x/z — only
 * the vehicle's (#593) — so the driller's position stayed frozen wherever
 * they originally boarded regardless of where the rig actually drove. #593
 * fixed that: releaseVehicleReservation now leaves a dismounting driver
 * exactly where their vehicle stopped, which for a plan finishing inside
 * this file's 3x3 pattern is the pattern itself. These tests are about
 * flyrock reaching the crew crewBesideTheBlast places deliberately, not
 * about the incidental rig driver; parking them somewhere the blast can't
 * reach keeps that RNG draw about the crew alone, same as before #593 made
 * the driller's real position visible.
 */
function driveDrillPlanToCompletion(ctx: MiningContext, maxTicks = 400): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedDrillHoles.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
  const driller = ctx.state!.employees.employees.find(e => e.id === 1);
  if (driller) {
    driller.x = 44;
    driller.z = 44;
  }
}

/**
 * Ticks until every charge ordered by the last `charge hole:*` has landed in
 * state.chargesByHole (#554), mirroring driveDrillPlanToCompletion above.
 *
 * Charging is on-foot work (no vehicle gate, unlike drilling) — either the
 * driller (id 1, relocated clear by driveDrillPlanToCompletion above once
 * drilling finished) or the staffed blaster (id 2, also 'blasting'-qualified,
 * STARTING_SITE_STAFFED_COMPOSITION) can walk back into the pattern to claim
 * a charge_hole action, undoing that relocation. Same reasoning as the drill
 * helper's own relocation: these tests are about flyrock reaching the crew
 * crewBesideTheBlast (or a test's own explicitly hired/positioned employee)
 * places deliberately, not about whichever staffed employee happened to do
 * the charging — so only ids 1/2 (the staffed opening's driller/blaster,
 * hired before any test-specific crew) are parked clear of the pattern once
 * every charge has landed. Relocating by qualification instead of by these
 * fixed ids would also sweep up a test's own deliberately-placed 'driller'-
 * role bystanders (crewBesideTheBlast, onTheBlast), which are 'blasting'-
 * qualified too (ROLE_STARTING_QUALIFICATION) but must stay exactly where
 * each test put them.
 */
function driveChargePlanToCompletion(ctx: MiningContext, maxTicks = 400): void {
  for (let i = 0; i < maxTicks && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
  for (const emp of ctx.state!.employees.employees) {
    if (emp.id === 1 || emp.id === 2) {
      emp.x = 44;
      emp.z = 44;
    }
  }
}

/** Fire a 3×3 pattern at (15,15) with the given stemming. */
function blastAt(ctx: MiningContext, stemming: string): void {
  resetHoleIds();
  drillPlanCommand(ctx, ['grid'], { rows: '3', cols: '3', spacing: '3', depth: '8', start: '15,15' });
  driveDrillPlanToCompletion(ctx);
  chargeCommand(ctx, [], { hole: '*', explosive: 'boomite', amount: '8', stemming });
  driveChargePlanToCompletion(ctx);
  sequenceCommand(ctx, ['auto'], { delay_step: '25' });
  const result = blastCommand(ctx, [], {});
  expect(result.success, result.output).toBe(true);
}

/**
 * Stand a crew just outside the pattern — holes span x=15..21, z=15..21, so
 * this is clear of the ground that disappears (at every stemming this suite
 * fires, including the well-stemmed '2' case, which clears *more* ground than
 * a poorly-stemmed shot since more of its energy goes down instead of up) but
 * well inside a minimally-stemmed (0.5m, the createCharge floor) shot's throw.
 *
 * Hired as 'driver', not 'driller' (#554): a 'driller' is 'blasting'-
 * qualified (ROLE_STARTING_QUALIFICATION), and charge_hole — unlike
 * drill_hole — has no vehicle gate, so any 'blasting'-qualified bystander
 * standing this close to the pattern would get dispatched to walk in and
 * charge a hole itself (nearest-first, ActionSelection.ts), planting exactly
 * the passive bystander these tests need beside the blast squarely on top of
 * it instead. 'driver' carries no qualification charge_hole/drill_hole ever
 * checks, so this crew can only ever be a bystander, never a blaster.
 */
function crewBesideTheBlast(ctx: MiningContext, count = 12): number[] {
  const rng = new Random(7);
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const hire = hireEmployee(ctx.state!.employees, 'driver', rng, 24 + (i % 4), 14 + Math.floor(i / 4));
    if (hire.employee) ids.push(hire.employee.id);
  }
  return ids;
}

const aliveCount = (ctx: MiningContext, ids: number[]): number =>
  ctx.state!.employees.employees.filter(e => ids.includes(e.id) && e.alive && !e.injured).length;

beforeEach(() => resetHoleIds());

describe('Blast flyrock — danger reaches the crew', () => {
  it('a minimally stemmed overcharge throws rock that hurts people standing nearby', () => {
    const ctx = makeCtx();
    const crew = crewBesideTheBlast(ctx);
    const before = aliveCount(ctx, crew);

    blastAt(ctx, '0.5');

    expect(before).toBeGreaterThan(0);
    expect(aliveCount(ctx, crew), 'minimally stemmed flyrock hurt nobody').toBeLessThan(before);
    expect(ctx.state!.damage.accidents.length).toBeGreaterThan(0);
  });

  it('the same charge, properly stemmed, leaves the crew alone', () => {
    const ctx = makeCtx();
    const crew = crewBesideTheBlast(ctx);
    const before = aliveCount(ctx, crew);

    blastAt(ctx, '2');

    expect(aliveCount(ctx, crew)).toBe(before);
  });

  it('records the accident so the lawsuit and safety systems can see it', () => {
    const ctx = makeCtx();
    crewBesideTheBlast(ctx);

    blastAt(ctx, '0.5');

    const casualties = ctx.state!.damage.accidents.filter(a => a.type === 'death' || a.type === 'injury');
    expect(casualties.length).toBeGreaterThan(0);
    for (const accident of casualties) {
      expect(accident.kineticEnergy).toBeGreaterThan(0);
      expect(accident.tick).toBe(ctx.state!.tickCount);
    }
  });

  it('a blast with nobody around hurts nobody', () => {
    const ctx = makeCtx();

    blastAt(ctx, '0.5');

    expect(ctx.state!.damage.accidents.filter(a => a.type === 'death').length).toBe(0);
    expect(ctx.state!.damage.deathCount).toBe(0);
  });

  it('kills anyone standing on the ground the blast removes, however well stemmed', () => {
    const ctx = makeCtx();
    const rng = new Random(3);
    // Right on top of the pattern, not beside it.
    const onTheBlast = hireEmployee(ctx.state!.employees, 'driller', rng, 16, 16).employee;

    blastAt(ctx, '2'); // a careful blast — the ground still disappears

    expect(onTheBlast.alive, 'stood on the blast and survived').toBe(false);
    expect(ctx.state!.damage.deathCount).toBeGreaterThan(0);
    expect(ctx.state!.damage.lawsuitPending).toBe(true);
  });

  it('destroys a vehicle parked on the blast', () => {
    const ctx = makeCtx();
    const parked = purchaseVehicle(ctx.state!.vehicles, 'debris_hauler', 16, 16).vehicle;

    blastAt(ctx, '2');

    expect(ctx.state!.vehicles.vehicles.some(v => v.id === parked.id)).toBe(false);
  });

  it('leaves people well clear of the blast alone', () => {
    const ctx = makeCtx();
    const rng = new Random(11);
    // 'driver', not 'driller' (#554) — same reasoning as crewBesideTheBlast:
    // a 'blasting'-qualified bystander this far out could still get
    // dispatched to walk in and charge a hole (charge_hole has no vehicle
    // gate), which is exactly the "well clear" this test means to prove.
    const farAway = hireEmployee(ctx.state!.employees, 'driver', rng, 44, 44).employee;

    blastAt(ctx, '0.5');

    expect(farAway.alive).toBe(true);
    expect(farAway.injured).toBe(false);
  });

  it('reports how far the rock was thrown, and rates the blast on it', () => {
    const reckless = makeCtx();
    blastAt(reckless, '0.5');
    const careful = makeCtx();
    blastAt(careful, '2');

    // Both reports exist; the reckless one threw rock further and rates worse.
    resetHoleIds();
    drillPlanCommand(reckless, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8', start: '30,30' });
    driveDrillPlanToCompletion(reckless);
    chargeCommand(reckless, [], { hole: '*', explosive: 'boomite', amount: '8', stemming: '0.5' });
    driveChargePlanToCompletion(reckless);
    sequenceCommand(reckless, ['auto'], {});
    const output = blastCommand(reckless, [], {}).output;

    expect(output).toMatch(/Furthest throw: \d+\.\d m/);
  });

  it('destroys a building whose footprint overlaps a cleared voxel, however well stemmed', () => {
    const ctx = makeCtx();
    const placed = placeBuilding(
      ctx.state!.buildings, 'living_quarters', 18, 18,
      ctx.state!.world!.sizeX, ctx.state!.world!.sizeZ, 1,
    );
    expect(placed.success, placed.error).toBe(true);

    blastAt(ctx, '2'); // a careful blast — the footprint still disappears

    expect(ctx.state!.buildings.buildings.some(b => b.id === placed.building!.id)).toBe(false);
  });

  it('nothing outside computeDangerZone\'s padded bounds is touched, regardless of proximity to a landed projectile', () => {
    const ctx = makeCtx();
    resetHoleIds();
    drillPlanCommand(ctx, ['grid'], { rows: '3', cols: '3', spacing: '3', depth: '8', start: '15,15' });
    driveDrillPlanToCompletion(ctx);
    const zone = computeDangerZone(ctx.state!.drillHoles, BLAST_DANGER_MARGIN_M)!;
    expect(zone).not.toBeNull();

    // Just past the padded zone's east edge — well clear by construction,
    // whatever a bad plan happens to throw.
    const safeX = zone.x2 + 1;
    const safeZ = 15;
    expect(isInZone(safeX, safeZ, zone)).toBe(false);

    const rng = new Random(21);
    const farAway = hireEmployee(ctx.state!.employees, 'driver', rng, safeX, safeZ).employee;
    const farVehicle = purchaseVehicle(ctx.state!.vehicles, 'debris_hauler', safeX, safeZ + 1).vehicle;

    chargeCommand(ctx, [], { hole: '*', explosive: 'boomite', amount: '8', stemming: '0.5' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['auto'], { delay_step: '25' });
    const result = blastCommand(ctx, [], {});
    expect(result.success, result.output).toBe(true);

    expect(farAway.alive).toBe(true);
    expect(farAway.injured).toBe(false);
    expect(ctx.state!.vehicles.vehicles.some(v => v.id === farVehicle.id)).toBe(true);
  });

  // ── The audited damage-model gap (#557) ──────────────────────────────────
  // BLAST_DANGER_MARGIN_M (15) pads the danger zone far past HIT_RADIUS (2,
  // Damage.ts) — someone standing a few metres inside the zone, off any
  // column the blast actually clears, currently has near-zero chance of
  // landing within 2 units of any one fragment's real resting position, so
  // processProjections does nothing to them. These pin the OUTCOME the fix
  // must produce (a real injury/death/damage/destruction from a
  // distance-attenuated kinetic-energy model), not today's silent miss —
  // they are expected to fail until that attenuation exists.
  //
  // (26,15)/(27,16)/(26,21) sit 3-6m past the reckless pattern's own cleared
  // footprint (x14-23, z13-22 for this exact plan/seed) — inside
  // BLAST_DANGER_MARGIN_M, outside HIT_RADIUS of where the current model's
  // fragments actually land, and confirmed (40-seed sweep) to take zero
  // outcome under the current hard 2m cutoff every single time.
  describe('the distance-attenuated debris gap: a few metres inside the zone, off any cleared column', () => {
    it('hurts or kills an employee standing just past the cleared footprint', () => {
      const ctx = makeCtx();
      const rng = new Random(2000);
      const bystander = hireEmployee(ctx.state!.employees, 'driver', rng, 26, 15).employee;

      blastAt(ctx, '0.5');

      const tookOutcome = !bystander.alive || bystander.injured;
      expect(tookOutcome, 'bystander a few metres inside the zone took no outcome at all').toBe(true);
    });

    it('damages or destroys a vehicle standing just past the cleared footprint', () => {
      const ctx = makeCtx();
      const parked = purchaseVehicle(ctx.state!.vehicles, 'debris_hauler', 27, 16).vehicle;

      blastAt(ctx, '0.5');

      const destroyed = !ctx.state!.vehicles.vehicles.some(v => v.id === parked.id);
      const damaged = ctx.state!.damage.accidents.some(a =>
        a.entityId === parked.id && (a.type === 'vehicle_damage' || a.type === 'vehicle_destroyed'));
      expect(destroyed || damaged, 'vehicle a few metres inside the zone took no outcome at all').toBe(true);
    });

    it('damages or destroys a building standing just past the cleared footprint', () => {
      const ctx = makeCtx();
      const placed = placeBuilding(
        ctx.state!.buildings, 'living_quarters', 26, 21,
        ctx.state!.world!.sizeX, ctx.state!.world!.sizeZ, 1,
      );
      expect(placed.success, placed.error).toBe(true);

      blastAt(ctx, '0.5');

      const destroyed = !ctx.state!.buildings.buildings.some(b => b.id === placed.building!.id);
      const damaged = ctx.state!.damage.accidents.some(a =>
        a.entityId === placed.building!.id && (a.type === 'building_damage' || a.type === 'building_destroyed'));
      expect(destroyed || damaged, 'building a few metres inside the zone took no outcome at all').toBe(true);
    });
  });
});
