// BlastSimulator2026 — Regression coverage for #1115: a dual-licensed
// employee's own reserve-ahead vehicle reservation can survive a forced rest
// promotion, leaving a reservation with no valid holder behind
// (I5_reservation_without_valid_holder, and occasionally
// I4_vehicle_moved_without_occupant) — WorldInvariants.ts's own I5 check.
//
// Root cause (per #1115's planner analysis, not re-derived here): an ordinary
// forced-rest promotion is meant to release any vehicle-gated action still
// sitting in the employee's own taskQueue before the rest starts
// (releaseUnboardedTaskQueueVehicleReservations, EmployeeDispatchSteps.ts,
// called from ForceShiftRest.ts's finishForceRest). That release loop skips a
// taskQueue entry whenever its reserved vehicle already has ANY driver
// (`vehicleDriverId(vehicle) !== null`) — written as a defensive
// "should-not-occur, already boarded" guard. When the vehicle's driver seat
// is occupied by someone OTHER than the taskQueue entry's own holder, the
// guard is wrong: nothing releases the reservation, the employee starts
// resting, and WorldInvariants.ts's own I5 check no longer exempts a resting
// holder from validity (`isPendingReserveAhead` requires
// `restTicksRemaining === null`) — so the stale reservation is now flagged
// for the whole rest.
//
// This test pins that mechanism directly, driving the real
// `forceShiftRestIfNeeded` -> `finishForceRest` ->
// `releaseUnboardedTaskQueueVehicleReservations` call chain rather than
// re-implementing it, matching this suite's own convention (see
// vehicles.integration.test.ts's "forced to rest while mid-drive" case) of
// constructing the exact mid-sequence state directly instead of waiting for
// dispatch to reach it by chance.

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { vehicleCommand } from '../../src/console/commands/vehicle.js';
import { makeGameContext } from '../helpers/gameContext.js';
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';
import { hireEmployee, assignSkill } from '../../src/core/entities/Employee.js';
import { placeBuilding } from '../../src/core/entities/Building.js';
import { reserveVehicle } from '../../src/core/engine/VehicleReservation.js';
import { vehicleDriverId, getVehicleReservation } from '../../src/core/entities/Vehicle.js';
import { forceShiftRestIfNeeded } from '../../src/core/engine/ForceShiftRest.js';
import { Random } from '../../src/core/math/Random.js';
import { WORK_DURATION_TICKS } from '../../src/core/config/balance.js';
import type { PendingAction } from '../../src/core/state/GameState.js';

function makeCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: 42, size: 32, cash: 1000000 });
}

describe('Vehicle reservation survives a forced-rest promotion (#1115)', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
    // A living_quarters covering the whole map so forceShiftRestIfNeeded's
    // own resolveRestDestination always finds a worthwhile-to-reach rest
    // target, mirroring vehicles.integration.test.ts's own forced-rest setup.
    ctx.state!.buildings.unlockedTiers.living_quarters = 2;
    placeBuilding(ctx.state!.buildings, 'living_quarters', 0, 0, 100, 100, 2);
  });

  it(
    'a reserve-ahead reservation on a second vehicle whose driver seat is occupied by someone else ' +
    'is not released before the reservation holder is forced to rest, tripping I5',
    () => {
      // Two different-role vehicles, matching the issue's own repro shape:
      // a dual-licensed employee busy on a rock_fragmenter, with a
      // debris_hauler action reserved ahead in their own taskQueue.
      vehicleCommand(ctx, ['buy', 'rock_fragmenter'], {});
      vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
      const vehicleA = ctx.state!.vehicles.vehicles[0]!; // rock_fragmenter
      const vehicleB = ctx.state!.vehicles.vehicles[1]!; // debris_hauler

      // The dual-licensed reservation holder — driving + driving.excavator,
      // licensed for both rock_fragmenter and debris_hauler (#1115's own
      // wording) — currently mounted and actively working vehicleA.
      const rng = new Random(1);
      const { employee: holder } = hireEmployee(ctx.state!.employees, 'driller', rng, vehicleA.x, vehicleA.z);
      assignSkill(ctx.state!.employees, holder.id, 'driving.excavator', 1);
      assignSkill(ctx.state!.employees, holder.id, 'driving.truck', 1);

      const actionA: PendingAction = {
        id: 9001,
        type: 'fragment_debris',
        requiredSkill: null,
        requiredVehicleRole: 'rock_fragmenter',
        targetX: vehicleA.x,
        targetZ: vehicleA.z,
        targetY: 0,
        payload: {},
        targetEmployeeId: holder.id,
        status: 'assigned',
        holderId: holder.id,
        queuedAtTick: 0,
      };
      ctx.state!.pendingActions.push(actionA);
      vehicleA.occupantIds = [holder.id];
      holder.locomotion = { kind: 'mounted', vehicleId: vehicleA.id };
      holder.x = vehicleA.x;
      holder.z = vehicleA.z;
      holder.activeActionId = actionA.id;
      // Mid-drive toward actionA's own target (taskTicksRemaining not yet
      // seeded — seedTaskTimerFields only runs on arrival), the exact phase
      // forceShiftRestIfNeeded's own #922 unit test already pins as
      // interruptible (mirrors vehicles.integration.test.ts's "forced to
      // rest while mid-drive" case above). Genuinely busy on vehicle-gated
      // work — not resting, not walking to rest.
      holder.taskTicksRemaining = null;
      holder.ticksWorked = WORK_DURATION_TICKS; // crosses forceShiftRestIfNeeded's own threshold
      // Fatigued enough that resolveRestDestination's own round-trip-worthwhile
      // check (RestActionHelpers.ts) finds real headroom to recover — a fresh
      // hire's fatigue starts at MAX_NEED_GAUGE (fully rested, zero headroom),
      // which would make forceShiftRestIfNeeded's own dest.worthwhile check
      // refuse to send them at all.
      holder.fatigue = 20;
      reserveVehicle(ctx.state!.vehicles, vehicleA.id, actionA.id);

      // The reserve-ahead follow-up (reserveOnePoolActionAhead's own shape):
      // a debris_hauler action reserved onto vehicleB and pushed into the
      // holder's own taskQueue, while they are still busy elsewhere on
      // vehicleA above — an entirely ordinary, non-buggy state on its own.
      const actionB: PendingAction = {
        id: 9002,
        type: 'haul_debris',
        requiredSkill: null,
        requiredVehicleRole: 'debris_hauler',
        targetX: vehicleB.x,
        targetZ: vehicleB.z,
        targetY: 0,
        payload: {},
        targetEmployeeId: null,
        status: 'assigned',
        holderId: holder.id,
        queuedAtTick: 0,
      };
      ctx.state!.pendingActions.push(actionB);
      reserveVehicle(ctx.state!.vehicles, vehicleB.id, actionB.id);
      holder.taskQueue = [actionB.id];

      // The ordering-bug shape (#1115): vehicleB's own driver seat is
      // occupied by a DIFFERENT employee — not the reservation's holder —
      // while the reservation itself still names actionB/holder.
      // releaseUnboardedTaskQueueVehicleReservations's own defensive skip
      // ("vehicleDriverId(vehicle) !== null" => already boarded, leave it
      // alone) treats this as the harmless "already boarded" case it was
      // written for, when it is really a stale reservation nobody has
      // resolved.
      const rng2 = new Random(2);
      const { employee: other } = hireEmployee(ctx.state!.employees, 'driller', rng2, vehicleB.x, vehicleB.z);
      assignSkill(ctx.state!.employees, other.id, 'driving.truck', 1);
      vehicleB.occupantIds = [other.id];
      other.locomotion = { kind: 'mounted', vehicleId: vehicleB.id };
      other.x = vehicleB.x;
      other.z = vehicleB.z;

      expect(vehicleDriverId(vehicleB)).toBe(other.id);
      expect(getVehicleReservation(ctx.state!.vehicles, vehicleB.id)).toBe(actionB.id);

      // Drive the real forced-rest promotion — the exact call chain
      // ForceShiftRest.ts's own finishForceRest uses in production
      // (interruptActiveAction on the CURRENT active action, then
      // releaseUnboardedTaskQueueVehicleReservations on the taskQueue).
      forceShiftRestIfNeeded(ctx.state!, holder, [], []);

      // The holder is now resting (or walking to rest) — WorldInvariants.ts's
      // own I5 check no longer exempts them via isPendingReserveAhead once
      // that happens.
      expect(holder.restTicksRemaining !== null || holder.pendingRestDuration !== null).toBe(true);

      // Pin the mechanism, not just the symptom: releaseUnboardedTaskQueueVehicleReservations
      // (called from finishForceRest, synchronously inside forceShiftRestIfNeeded
      // above) must have released the stale reservation on vehicleB back to the
      // open pool, and dropped actionB from the holder's own taskQueue, before the
      // rest began — the fixed guard only special-cases a vehicle boarded by
      // `employee` themself, so `other`'s occupancy no longer counts as
      // "already boarded, leave it".
      expect(getVehicleReservation(ctx.state!.vehicles, vehicleB.id)).toBeNull();
      expect(holder.taskQueue).not.toContain(actionB.id);

      // The acceptance shape: no I5/I4 violations survive at all — the fix
      // releases the reservation before the rest starts, so it never has a
      // chance to sit stale through it.
      expectNoWorldInvariantViolations(ctx.state!);
    },
  );

  // FATAL_VIOLATION_KINDS's own I4/I5 membership is covered directly in
  // tests/unit/state/WorldInvariants.test.ts, alongside its I5 describe
  // block — not duplicated here.
});
