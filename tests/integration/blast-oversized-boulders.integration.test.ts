// BlastSimulator2026 — Integration test: oversized boulder breaking (#484)
//
// A debris_hauler must refuse an oversized fragment; a crewed
// rock_fragmenter must be able to drive to it and break it in place via the
// real "vehicle break" console command, replacing it in logistics with
// haulable sub-fragments that preserve total volume. Mirrors
// economy.integration.test.ts's "completes the full economy loop" case; the
// shot is undercharged by its explosive (the weakest one, filled to the
// stemming, holes wide apart = oversized fragments, zero projections).

import { isFragmentSealed } from '../../src/core/economy/SealedFragments.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext } from '../../src/console/commands/world.js';
import { buildCommand } from '../../src/console/commands/entities.js';
import { employeeCommand } from '../../src/console/commands/employees.js';
import { vehicleCommand } from '../../src/console/commands/vehicle.js';
import { tickCommand } from '../../src/console/commands/events.js';
import {
  drillPlanCommand,
  chargeCommand,
  blastCommand,
} from '../../src/console/commands/mining.js';
import { isOversized } from '../../src/core/mining/BlastCalc.js';
import { releaseVehicleReservation } from '../../src/core/engine/VehicleReservation.js';
import { getVehicleReservation } from '../../src/core/entities/Vehicle.js';
import { makeGameContext } from '../helpers/gameContext.js';
import { deliverExplosivesNow } from '../helpers/playthrough.js';
import { driveChargePlanToCompletion } from './full-level/helpers.js';

/**
 * `cash:` is raised above the $50,000 default because `vehicle buy` now
 * refuses an unaffordable purchase instead of overdrawing: this test crews
 * both a debris_hauler ($25,000) and a rock_fragmenter ($32,000), which the
 * default balance cannot cover once payroll and upkeep have run. Nothing here
 * asserts anything about money.
 */
function makeCtx(): GameContext {
  // Seed 1 (was 42): the final tail of this test hauls a resulting piece into the
  // freight_warehouse, which only takes ore-bearing rock (barren rock goes to a
  // spoil heap, #1530). Seed 42's blast now leaves only barren fragments because
  // real-cost action selection (#1586) drills the four holes in a different
  // order, which changes the blast; the seed is just the rock fixture.
  return makeGameContext({ mineType: 'desert', seed: 1, size: 32, cash: 1000000 });
}

/**
 * Hires one driller (qualified 'blasting' by default, ROLE_STARTING_QUALIFICATIONS)
 * and buys one drill_rig and one charging_truck (#1649), so drill_plan grid's queued drill_hole
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
  // Charging is worked from a charging truck by a blasting + driving.truck crew member (#1649).
  employeeCommand(ctx, ['assign_skill', String(drillerId)], { skill: 'driving.truck', level: '1' });
  const buyTruck = vehicleCommand(ctx, ['buy', 'charging_truck'], {});
  expect(buyTruck.success).toBe(true);
}

/**
 * Ticks until every hole ordered by the last drill_plan grid has landed in
 * state.drillHoles (#553). Tops up employee need gauges each tick — a
 * solo drill_rig/driller multi-hole drive can otherwise run long enough for
 * fatigue to cross a collapse threshold mid-drive, an
 * unrelated needs mechanic this test isn't exercising.
 */
function driveDrillPlanToCompletion(ctx: GameContext, maxTicks = 400): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedDrillHoles.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
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
      emp.fatigue = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

/**
 * Drill+charge+blast an undercharged, wide-spacing pattern at
 * (18,19) — same origin as economy.integration.test.ts's full-loop case: it
 * sits on the same flat NavGrid bench as the vehicle spawn and warehouse, so
 * fragments land somewhere a vehicle can actually reach. The holes, 5 m
 * apart, are filled with pop_rock, the weakest explosive (1.375 kg/m), up to
 * 4 m of stemming: half of each 8 m hole charged. Measured under the kernel
 * energy model it breaks out into 254 fragments, 9 of them boulders past the
 * 2 m³ oversized threshold (largest 6.6 m³), with zero projections. Filled up
 * to 2 m it breaks finer: its largest piece is 2 m³, not past the threshold.
 * A partial 2 kg charge, the old undercharge, breaks nothing at all here.
 */
function blastUndercharged(ctx: GameContext): void {
  // Pop_rock fizzles in a hole that holds water: the weather is pinned dry, rain is not what this test is about.
  ctx.state!.weather = { ...ctx.state!.weather, current: 'sunny', pinned: true };
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
    explosive: 'pop_rock',
    stemming: '4m',
  });
  expect(chargeResult.success).toBe(true);
  deliverExplosivesNow(ctx.state!); // timing downstream of the charge is the subject, not the delivery wait (#1895)
  driveChargePlanToCompletion(ctx);

  // The shot breaks out, and the blaster and the two rigs stand parked on the pattern (the lone driller
  // crews one rig at a time, so the other cannot be driven off). Losing them is not what this test is
  // about: park the whole crew and fleet on the far edge of the site first.
  for (const e of ctx.state!.employees.employees) { e.x = 2; e.z = 2; e.destinationX = null; e.destinationZ = null; }
  for (const v of ctx.state!.vehicles.vehicles) { v.x = 2; v.z = 2; }

  const blastResult = blastCommand(ctx as any, [], {});
  expect(blastResult.success).toBe(true);
  expect(ctx.state!.lastBlastReport!.projectionCount).toBe(0);
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
    // The shot broke out, so its boulders lie open, not sealed under a cap (sealed rock gets no order, #1774).
    const boulderPos = oversizedTracked!.fragment.position;
    expect(isFragmentSealed(ctx.grid!, boulderPos)).toBe(false);
    const oversizedId = oversizedTracked!.fragment.id;

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
    // does unprompted, so assert that automatic outcome instead.
    const hireFragmenterDriver = employeeCommand(ctx, ['hire'], { role: 'driver' });
    expect(hireFragmenterDriver.success).toBe(true);
    const fragmenterDriverId = ctx.state!.employees.employees
      .filter(e => e.role === 'driver')
      .find(e => e.id !== haulerDriverId)!.id;
    employeeCommand(ctx, ['assign_skill', String(fragmenterDriverId)], { skill: 'driving.rock_fragmenter', level: '5' });

    const buyFragmenter = vehicleCommand(ctx, ['buy', 'rock_fragmenter'], {});
    expect(buyFragmenter.success).toBe(true);

    const assignFragmenter = vehicleCommand(ctx, ['driver', String(ctx.state!.vehicles.vehicles.find(v => v.type === 'rock_fragmenter')!.id), String(fragmenterDriverId)], {});
    expect(assignFragmenter.success).toBe(true);

    // The undercharged, wide-spacing blast leaves a whole rubble field with
    // many oversized fragments (#484 only breaks one boulder at a time), and
    // self-dispatch (#552) works through whichever it reaches first, so the
    // boulder this checks is the first one the fragmenter breaks, not a
    // chosen one. A single fragmenter completes at most one break per tick,
    // so the tick in which an oversized fragment vanishes, diffed against the
    // snapshot taken just before it, isolates exactly its own split.
    const oversizedVolumes = new Map(
      ctx.state!.logistics.fragments.filter(f => isOversized(f.fragment.volume)).map(f => [f.fragment.id, f.fragment.volume]),
    );
    let idsJustBeforeBreak = new Set(ctx.state!.logistics.fragments.map(f => f.fragment.id));
    let brokenId: number | undefined;
    for (let ticks = 0; ticks < 500 && brokenId === undefined; ticks++) {
      idsJustBeforeBreak = new Set(ctx.state!.logistics.fragments.map(f => f.fragment.id));
      tickCommand(ctx, ['1'], {});
      const present = new Set(ctx.state!.logistics.fragments.map(f => f.fragment.id));
      brokenId = [...oversizedVolumes.keys()].find(id => idsJustBeforeBreak.has(id) && !present.has(id));
    }
    expect(brokenId, 'the crewed rock_fragmenter broke no oversized fragment').toBeDefined();

    const pieces = ctx.state!.logistics.fragments.filter(
      f => f.state === 'on_ground' && !idsJustBeforeBreak.has(f.fragment.id),
    );
    expect(pieces.length).toBeGreaterThan(0);

    let totalVolume = 0;
    for (const p of pieces) {
      expect(isOversized(p.fragment.volume)).toBe(false);
      totalVolume += p.fragment.volume;
    }
    expect(Math.abs(totalVolume - oversizedVolumes.get(brokenId!)!)).toBeLessThan(1e-6);

    // 4. Build a freight_warehouse and haul one resulting piece; stored mass
    // must grow by exactly that piece's mass.
    // #556: confirming the order only queues a construction site — a
    // dedicated fresh employee (not the hauler/fragmenter drivers, both
    // already committed to their own vehicles) finishes it before the manual
    // haul below, which needs an active depot to accept the piece at all.
    const hireBuilder = employeeCommand(ctx, ['hire'], { role: 'manager' });
    expect(hireBuilder.success).toBe(true);

    // #1305: site moved (13,15) -> (9,12); the old site was only reachable
    // through a ramp connection across an unclimbable step, which
    // findRampConnections no longer emits.
    const buildResult = buildCommand(ctx, ['freight_warehouse'], { at: '9,12' });
    expect(buildResult.success).toBe(true);
    driveConstructionToCompletion(ctx);
    expect(ctx.state!.buildings.buildings.some(b => b.type === 'freight_warehouse')).toBe(true);

    const piece = pieces[0]!;
    const pieceMass = piece.fragment.mass;

    // #1090: nothing dismounts on completion any more, so this already-
    // mounted, idle, licensed hauler is fair game for self-dispatch
    // (syncHaulDispatch, #552) the instant the freight_warehouse goes
    // active — by the time this manual haul command runs, the vehicle may
    // already be mid-haul on a different, self-dispatched fragment
    // (requestHaulFragment's own already-busy guard would then reject this
    // exact command). Reset it to a clean idle-but-mounted state first, the
    // same way completing a haul naturally leaves it, so this manual command
    // exercises exactly what it's meant to.
    const haulerVehicle = ctx.state!.vehicles.vehicles.find(v => v.id === haulerId)!;
    const haulerDriver = ctx.state!.employees.employees.find(e => e.id === haulerDriverId)!;
    // #1091: abortVehicleGatedFragmentWork is deleted — releaseVehicleReservation
    // (VehicleReservation.ts) is the real abort path now: it returns any
    // in-flight cargo to the ground and clears the reservation/display
    // task-state in one call (findAndAbortReservedVehicle's own doc comment).
    const haulerReservation = getVehicleReservation(ctx.state!.vehicles, haulerVehicle.id);
    if (haulerReservation !== null) {
      releaseVehicleReservation(ctx.state!, haulerReservation);
    }
    haulerDriver.isMoveStuck = false;
    haulerDriver.moveConsecutiveFailures = 0;
    haulerDriver.activeActionId = null;
    haulerDriver.taskQueue = [];
    haulerDriver.itinerary = null;
    // A same-tick self-dispatch race, or the sustained-stuck-abandon path
    // (#986), may already have dismounted this driver entirely — restore
    // them to the vehicle's own seat so requestHaulFragment's own
    // driverId-required guard passes, matching I2 (mounted position ==
    // vehicle position).
    haulerVehicle.occupantIds = [haulerDriver.id];
    haulerDriver.locomotion = { kind: 'mounted', vehicleId: haulerVehicle.id };
    haulerDriver.x = haulerVehicle.x;
    haulerDriver.z = haulerVehicle.z;

    const haulPiece = vehicleCommand(ctx, ['haul', String(haulerId)], { fragment: String(piece.fragment.id) });
    expect(haulPiece.success).toBe(true);

    const storedBefore = ctx.state!.logistics.storedMassKg;
    let ticks = 0;
    while (ctx.state!.logistics.storedMassKg === storedBefore && ticks < 60) {
      tickCommand(ctx, ['1'], {});
      ticks++;
    }
    // #1370: the trip may batch neighbouring pieces, so the stored growth is at least the piece's own mass.
    expect(ctx.state!.logistics.fragments.find(f => f.fragment.id === piece.fragment.id)!.state).toBe('stored');
    expect(ctx.state!.logistics.storedMassKg).toBeGreaterThanOrEqual(storedBefore + pieceMass - 1e-6);
  });
});
