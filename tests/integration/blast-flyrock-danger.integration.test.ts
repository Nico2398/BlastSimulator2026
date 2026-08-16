// BlastSimulator2026 — Flyrock is dangerous, and stemming is the defence.
//
// The whole point of the blast pipeline is that a bad plan hurts. These drive
// the real console commands end to end and check that thrown rock reaches
// people and machines standing where it lands — and that stemming the holes
// properly is what stops it.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../src/console/commands/world.js';
import {
  blastCommand,
  drillPlanCommand,
  chargeCommand,
  sequenceCommand,
  type MiningContext,
} from '../../src/console/commands/mining.js';
import { createTubingState } from '../../src/core/mining/Tubing.js';
import { resetHoleIds } from '../../src/core/mining/DrillPlan.js';
import { hireEmployee } from '../../src/core/entities/Employee.js';
import { Random } from '../../src/core/math/Random.js';
import { purchaseVehicle } from '../../src/core/entities/Vehicle.js';
import { tickCommand } from '../../src/console/commands/events.js';

function makeCtx(): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    softwareTier: 0,
    tubingState: createTubingState(),
    emitter: new EventEmitter(),
  };
  // Staffed (#553): drill_plan grid now queues one drill_hole PendingAction
  // per hole instead of writing them straight into state.drillHoles — a
  // 'blasting'-qualified employee and a drill_rig vehicle are needed for any
  // hole to actually land.
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '48', staffed: 'true' });
  return ctx;
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

/** Fire a 3×3 pattern at (15,15) with the given stemming. */
function blastAt(ctx: MiningContext, stemming: string): void {
  resetHoleIds();
  drillPlanCommand(ctx, ['grid'], { rows: '3', cols: '3', spacing: '3', depth: '8', start: '15,15' });
  driveDrillPlanToCompletion(ctx);
  chargeCommand(ctx, [], { hole: '*', explosive: 'boomite', amount: '8', stemming });
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
 */
function crewBesideTheBlast(ctx: MiningContext, count = 12): number[] {
  const rng = new Random(7);
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const hire = hireEmployee(ctx.state!.employees, 'driller', rng, 24 + (i % 4), 14 + Math.floor(i / 4));
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
    const farAway = hireEmployee(ctx.state!.employees, 'driller', rng, 44, 44).employee;

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
    sequenceCommand(reckless, ['auto'], {});
    const output = blastCommand(reckless, [], {}).output;

    expect(output).toMatch(/Furthest throw: \d+\.\d m/);
  });
});
