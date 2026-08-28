// BlastSimulator2026 — Integration test: oversized boulder breaking (#484)
//
// A debris_hauler must refuse an oversized fragment; a crewed
// rock_fragmenter must be able to drive to it and break it in place via the
// real "vehicle break" console command, replacing it in logistics with
// haulable sub-fragments that preserve total volume. Mirrors
// economy.integration.test.ts's "completes the full economy loop" case and
// blast-undercharge.json's charge parameters (small charge = oversized
// fragments, zero projections).

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { buildCommand } from '../../src/console/commands/entities.js';
import { employeeCommand } from '../../src/console/commands/employees.js';
import { vehicleCommand } from '../../src/console/commands/vehicle.js';
import { tickCommand } from '../../src/console/commands/events.js';
import {
  drillPlanCommand,
  chargeCommand,
  sequenceCommand,
  blastCommand,
} from '../../src/console/commands/mining.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { isOversized } from '../../src/core/mining/BlastCalc.js';

/**
 * `cash:` is raised above the $50,000 default because `vehicle buy` now
 * refuses an unaffordable purchase instead of overdrawing: this test crews
 * both a debris_hauler ($25,000) and a rock_fragmenter ($32,000), which the
 * default balance cannot cover once payroll and upkeep have run. Nothing here
 * asserts anything about money.
 */
function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, landscape: null, playableArea: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32', cash: '1000000' });
  return ctx;
}

/**
 * Hires one driller (qualified 'blasting' by default, ROLE_STARTING_QUALIFICATION)
 * and buys one drill_rig vehicle, so drill_plan grid's queued drill_hole
 * actions (#553) can actually land — deliberately NOT `staffed:true`
 * (STARTING_SITE_STAFFED_COMPOSITION also pre-crews a debris_hauler and
 * rock_fragmenter, which would race this test's own step-by-step manual
 * hauler/fragmenter setup via #552's self-dispatch).
 */
function hireDrillerAndRig(ctx: GameContext): void {
  const hireResult = employeeCommand(ctx, ['hire'], { role: 'driller' });
  expect(hireResult.success).toBe(true);
  const drillerId = ctx.state!.employees.employees.find(e => e.role === 'driller')!.id;
  employeeCommand(ctx, ['assign_skill', String(drillerId)], { skill: 'driving.drill_rig', level: '5' });
  const buyRig = vehicleCommand(ctx, ['buy', 'drill_rig'], {});
  expect(buyRig.success).toBe(true);
}

/**
 * Ticks until every hole ordered by the last drill_plan grid has landed in
 * state.drillHoles (#553). Tops up employee need gauges each tick — a
 * solo drill_rig/driller multi-hole drive can otherwise run long enough for
 * hunger/fatigue/breakNeed to cross a collapse threshold mid-drive, an
 * unrelated needs mechanic this test isn't exercising.
 */
function driveDrillPlanToCompletion(ctx: GameContext, maxTicks = 400): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedDrillHoles.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

/**
 * Ticks until every charge ordered by the last `charge hole:*` has landed in
 * state.chargesByHole (#554), mirroring driveDrillPlanToCompletion above.
 */
function driveChargePlanToCompletion(ctx: GameContext, maxTicks = 400): void {
  for (let i = 0; i < maxTicks && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

/**
 * Ticks until every construction site ordered so far has landed in
 * state.buildings.buildings (#556), mirroring driveDrillPlanToCompletion
 * above. A `place_building` order needs an idle employee to claim and finish
 * it — callers of this helper are expected to have hired one first.
 */
function driveConstructionToCompletion(ctx: GameContext, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedBuildings.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

/**
 * Drill+charge+sequence+blast an undercharged, wide-spacing pattern at
 * (18,19) — same origin as economy.integration.test.ts's full-loop case: it
 * sits on the same flat NavGrid bench as the vehicle spawn and warehouse, so
 * fragments land somewhere a vehicle can actually reach. Mirrors
 * blast-undercharge.json's charge parameters (2kg, wide 5m spacing), which
 * reliably leaves a couple of oversized fragments with zero projections.
 */
function blastUndercharged(ctx: GameContext): void {
  hireDrillerAndRig(ctx);

  const drillResult = drillPlanCommand(ctx as any, ['grid'], {
    origin: '18,19',
    rows: '2',
    cols: '2',
    spacing: '5',
    depth: '8',
  });
  expect(drillResult.success).toBe(true);
  driveDrillPlanToCompletion(ctx);

  const chargeResult = chargeCommand(ctx as any, [], {
    hole: '*',
    explosive: 'boomite',
    amount: '2kg',
    stemming: '2m',
  });
  expect(chargeResult.success).toBe(true);
  driveChargePlanToCompletion(ctx);

  const seqResult = sequenceCommand(ctx as any, ['auto'], {});
  expect(seqResult.success).toBe(true);

  const blastResult = blastCommand(ctx as any, [], {});
  expect(blastResult.success).toBe(true);
}

describe('Blast → oversized boulder → break in place (#484)', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('an undercharged, wide-spacing blast produces at least one oversized fragment', () => {
    blastUndercharged(ctx);

    const oversized = ctx.state!.logistics.fragments.filter(f => isOversized(f.fragment.volume));
    expect(oversized.length).toBeGreaterThan(0);
  });

  it('a crewed debris_hauler refuses an oversized fragment; a crewed rock_fragmenter breaks it in place; a resulting piece can then be hauled and stored', () => {
    // 1. Blast to produce an oversized fragment.
    blastUndercharged(ctx);

    const oversizedTracked = ctx.state!.logistics.fragments.find(f => isOversized(f.fragment.volume));
    expect(oversizedTracked).toBeDefined();
    const oversizedId = oversizedTracked!.fragment.id;
    const oversizedVolume = oversizedTracked!.fragment.volume;

    // 2. Crew a debris_hauler and attempt to haul the oversized fragment — must be refused.
    const hireHaulerDriver = employeeCommand(ctx, ['hire'], { role: 'driver' });
    expect(hireHaulerDriver.success).toBe(true);
    const haulerDriverId = ctx.state!.employees.employees.find(e => e.role === 'driver')!.id;
    employeeCommand(ctx, ['assign_skill', String(haulerDriverId)], { skill: 'driving.truck', level: '5' });

    const buyHauler = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(buyHauler.success).toBe(true);
    const haulerId = ctx.state!.vehicles.vehicles.find(v => v.type === 'debris_hauler')!.id;

    const assignHauler = vehicleCommand(ctx, ['driver', String(haulerId), String(haulerDriverId)], {});
    expect(assignHauler.success).toBe(true);
    for (let i = 0; i < 10; i++) tickCommand(ctx, ['1'], {});

    const haulAttempt = vehicleCommand(ctx, ['haul', String(haulerId)], { fragment: String(oversizedId) });
    expect(haulAttempt.success).toBe(false);
    expect(haulAttempt.output.length).toBeGreaterThan(0);
    expect(ctx.state!.logistics.fragments.find(f => f.fragment.id === oversizedId)!.state).toBe('on_ground');

    // 3. Crew a rock_fragmenter — hauling/fragmenting is self-dispatching now
    // (#552): syncHaulDispatch already queued a fragment_debris action for
    // every oversized fragment in this rubble field the instant the blast
    // landed, so the moment this fragmenter is crewed and idle it auto-claims
    // one and starts driving to it on its own. Calling the manual
    // `vehicle break` command here would race that auto-claim and fail with
    // "Vehicle is already breaking a fragment" — the manual command is still
    // a valid scripting/debug primitive (see the manual `haul` refusal check
    // above, which never races because it fails deterministically before any
    // vehicle state changes), but this step's whole premise (drive a crewed
    // fragmenter to the boulder and break it) is now exactly what auto-dispatch
    // does unprompted, so assert that automatic outcome instead. The rubble
    // field can hold more than one oversized fragment, so this waits out
    // however many the fragmenter works through before it reaches ours.
    const hireFragmenterDriver = employeeCommand(ctx, ['hire'], { role: 'driver' });
    expect(hireFragmenterDriver.success).toBe(true);
    const fragmenterDriverId = ctx.state!.employees.employees
      .filter(e => e.role === 'driver')
      .find(e => e.id !== haulerDriverId)!.id;
    employeeCommand(ctx, ['assign_skill', String(fragmenterDriverId)], { skill: 'driving.excavator', level: '5' });

    const buyFragmenter = vehicleCommand(ctx, ['buy', 'rock_fragmenter'], {});
    expect(buyFragmenter.success).toBe(true);

    const assignFragmenter = vehicleCommand(ctx, ['driver', String(ctx.state!.vehicles.vehicles.find(v => v.type === 'rock_fragmenter')!.id), String(fragmenterDriverId)], {});
    expect(assignFragmenter.success).toBe(true);

    // The undercharged, wide-spacing blast leaves a whole rubble field with
    // many oversized fragments (#484 only breaks the ONE targeted boulder),
    // and self-dispatch (#552) works through whichever it reaches first —
    // not necessarily ours. So "the resulting pieces" can't be scoped against
    // one snapshot taken before the wait: any other boulder the fragmenter
    // finishes first would leave its own pieces in that diff too. A single
    // fragmenter completes at most one break per tick, so re-snapshotting on
    // every iteration and keeping only the one taken immediately before
    // oversizedId itself vanishes isolates exactly its own split.
    let idsJustBeforeBreak = new Set(ctx.state!.logistics.fragments.map(f => f.fragment.id));
    let ticks = 0;
    while (ctx.state!.logistics.fragments.some(f => f.fragment.id === oversizedId) && ticks < 500) {
      idsJustBeforeBreak = new Set(ctx.state!.logistics.fragments.map(f => f.fragment.id));
      tickCommand(ctx, ['1'], {});
      ticks++;
    }
    expect(ctx.state!.logistics.fragments.some(f => f.fragment.id === oversizedId)).toBe(false);

    const pieces = ctx.state!.logistics.fragments.filter(
      f => f.state === 'on_ground' && !idsJustBeforeBreak.has(f.fragment.id),
    );
    expect(pieces.length).toBeGreaterThan(0);

    let totalVolume = 0;
    for (const p of pieces) {
      expect(isOversized(p.fragment.volume)).toBe(false);
      totalVolume += p.fragment.volume;
    }
    expect(Math.abs(totalVolume - oversizedVolume)).toBeLessThan(1e-6);

    // 4. Build a freight_warehouse and haul one resulting piece; stored mass
    // must grow by exactly that piece's mass.
    // #556: confirming the order only queues a construction site — a
    // dedicated fresh employee (not the hauler/fragmenter drivers, both
    // already committed to their own vehicles) finishes it before the manual
    // haul below, which needs an active depot to accept the piece at all.
    const hireBuilder = employeeCommand(ctx, ['hire'], { role: 'manager' });
    expect(hireBuilder.success).toBe(true);

    const buildResult = buildCommand(ctx, ['freight_warehouse'], { at: '13,13' });
    expect(buildResult.success).toBe(true);
    driveConstructionToCompletion(ctx);
    expect(ctx.state!.buildings.buildings.some(b => b.type === 'freight_warehouse')).toBe(true);

    const piece = pieces[0]!;
    const pieceMass = piece.fragment.mass;

    const haulPiece = vehicleCommand(ctx, ['haul', String(haulerId)], { fragment: String(piece.fragment.id) });
    expect(haulPiece.success).toBe(true);

    const storedBefore = ctx.state!.logistics.storedMassKg;
    ticks = 0;
    while (ctx.state!.logistics.storedMassKg === storedBefore && ticks < 60) {
      tickCommand(ctx, ['1'], {});
      ticks++;
    }
    expect(ctx.state!.logistics.storedMassKg).toBeCloseTo(storedBefore + pieceMass, 6);
  });
});
