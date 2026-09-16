// BlastSimulator2026 — Integration tests: Vehicle fleet (Phase 5)
// Covers purchase, listing, driver assignment, movement, task assignment, and tick.

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { vehicleCommand } from '../../src/console/commands/vehicle.js';
import { buildCommand, employeeCommand } from '../../src/console/commands/entities.js';
import { buildRampCommand } from '../../src/console/commands/mining.js';
import { tickCommand } from '../../src/console/commands/events.js';
import { makeGameContext, makeEmptyGameContext } from '../helpers/gameContext.js';
import {
  createVehicleState,
  purchaseVehicle,
  destroyVehicle,
  getVehicleDef,
  getVehicleDefByTier,
  getAllVehicleRoles,
} from '../../src/core/entities/Vehicle.js';
import type { VehicleTask } from '../../src/core/entities/Vehicle.js';
import { board } from '../../src/core/engine/Mount.js';
import {
  hireEmployee,
  assignSkill,
  killEmployee,
} from '../../src/core/entities/Employee.js';
import type { Employee } from '../../src/core/entities/Employee.js';
import { placeBuilding } from '../../src/core/entities/Building.js';
// #1089 (mount/itinerary rebuild phase 3b): tickVehicle/EntityMovementTick's
// position-writing movers are replaced by Locomotion.ts's tickLocomotion (the
// itinerary walker) and driveVehicleTowardTarget (ad hoc phase-driving, no
// itinerary) — both stubs at this (red) phase, so every test exercising them
// below is expected to fail for that reason.
import { tickLocomotion, driveVehicleTowardTarget } from '../../src/core/engine/Locomotion.js';
import { moveTo } from '../../src/core/engine/MoveTo.js';
import type { Leg } from '../../src/core/engine/Itinerary.js';
import { Random } from '../../src/core/math/Random.js';
import {
  TRAFFIC_JAM_MIN_VEHICLES,
  TRAFFIC_JAM_MIN_TICKS,
  VEHICLE_OCCUPANCY_REROUTE_THRESHOLD,
  WORK_DURATION_TICKS,
  MOVE_STUCK_ABANDON_TICKS,
  ACTION_STARVATION_TICK_THRESHOLD,
} from '../../src/core/config/balance.js';
import { createRunner, runCommand } from '../../src/console/createRunner.js';
import { createGame } from '../../src/core/state/GameState.js';
import type { PendingAction } from '../../src/core/state/GameState.js';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { NavGrid } from '../../src/core/nav/NavGrid.js';
// #922: driver-position invariant — no console command drives this directly,
// so the assertions below read findDrivenVehicle, the core-level lookup
// computeEmployeeActivity uses to report the driving/driving_to_task activity
// kinds (mesh suppression is a separate, independent lookup in EntitySync,
// proven at the renderer level by tests/unit/renderer/EntitySync.test.ts —
// this integration suite has no DOM/Three.js per this file's own header
// comment).
import { findDrivenVehicle } from '../../src/core/entities/EmployeeActivity.js';
// #1084: world-state invariant check — asserted at the end of every
// scenario-driving test below that has a full GameState to check. Its own
// stub throws 'not implemented', so every one of these assertions is
// expected to fail for that reason at this (red) phase — not from a bad
// import/type error.
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Build a fresh context with a real GameState (seed=42, desert biome).
 *
 * `cash:` is raised well above the $50,000 default because `vehicle buy` now
 * refuses an unaffordable purchase instead of overdrawing, and this file's
 * fleets cost more than the default balance: all five T1 roles come to
 * $172,000 and a single T3 drill_rig is $140,000. Money is never what these
 * tests are about — every cash assertion here is relative to `cashBefore` —
 * so the fix is to fund the fixture, not to weaken the guard.
 */
function makeCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: 42, size: 32, cash: 1000000 });
}

/** Hire one employee and return their numeric ID (always 1 on a fresh state). */
function hireOne(ctx: GameContext, role = 'driver'): number {
  const result = employeeCommand(ctx, ['hire'], { role });
  if (!result.success) throw new Error(`Setup: hire failed — ${result.output}`);
  return ctx.state!.employees.employees[0]!.id;
}

// ── Vehicle fleet ────────────────────────────────────────────────────────────

describe('Vehicle fleet', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  // ── Purchase ──

  it('buy vehicle adds to fleet list', () => {
    const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('debris_hauler');
    expect(result.output).toContain('#1');

    expect(ctx.state!.vehicles.vehicles).toHaveLength(1);
    expect(ctx.state!.vehicles.vehicles[0]!.type).toBe('debris_hauler');
    expect(ctx.state!.vehicles.vehicles[0]!.id).toBe(1);
    expectNoWorldInvariantViolations(ctx.state!);
  });

  it('buy vehicle reduces cash', () => {
    const cashBefore = ctx.state!.cash;
    const def = getVehicleDef('debris_hauler');

    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});

    expect(ctx.state!.cash).toBe(cashBefore - def.purchaseCost);
    expectNoWorldInvariantViolations(ctx.state!);
  });

  it('rejects unknown vehicle type', () => {
    const result = vehicleCommand(ctx, ['buy', 'spaceship'], {});

    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage: vehicle buy');
    expect(ctx.state!.vehicles.vehicles).toHaveLength(0);
    expectNoWorldInvariantViolations(ctx.state!);
  });

  it('vehicle list shows all vehicles', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    vehicleCommand(ctx, ['buy', 'drill_rig'], {});

    const result = vehicleCommand(ctx, ['list'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('debris_hauler');
    expect(result.output).toContain('drill_rig');
    expect(result.output).toContain('[1]');
    expect(result.output).toContain('[2]');
    expectNoWorldInvariantViolations(ctx.state!);
  });

  // ── Driver assignment ──

  it('assign driver with driving skill succeeds — driverId sets only after a tick resolves arrival (issue #437)', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    const eid = hireOne(ctx, 'driver');
    employeeCommand(ctx, ['assign_skill', String(eid)], { skill: 'driving.truck', level: '1' });

    const result = vehicleCommand(ctx, ['driver', '1', String(eid)], {});

    expect(result.success).toBe(true);
    expect(result.output).toBe(`Driver #${eid} walking to vehicle #1 to board.`);
    // The request succeeds immediately, but boarding is deferred to arrival —
    // driverId must not be set synchronously (previously it was, unconditionally).
    expect(ctx.state!.vehicles.vehicles[0]!.driverId).toBeNull();

    // The employee (hired at the same spawn point as the vehicle here) needs
    // one tick to resolve the arrival gate before driverId is actually set.
    tickCommand(ctx, ['1'], {});
    expect(ctx.state!.vehicles.vehicles[0]!.driverId).toBe(eid);
    expectNoWorldInvariantViolations(ctx.state!);
  });

  it('rejects unqualified driver', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    // blaster has no driving skill
    const eid = hireOne(ctx, 'blaster');

    const result = vehicleCommand(ctx, ['driver', '1', String(eid)], {});

    expect(result.success).toBe(false);
    expect(result.output).toContain('lacks licence');
    expect(ctx.state!.vehicles.vehicles[0]!.driverId).toBeNull();

    // Rejected at request time — a tick later, still no driver.
    tickCommand(ctx, ['1'], {});
    expect(ctx.state!.vehicles.vehicles[0]!.driverId).toBeNull();
    expectNoWorldInvariantViolations(ctx.state!);
  });

  // ── New (issue #437): driverId stays null until the arrival gate resolves ──

  it('driverId is null immediately after "vehicle driver" and only set once the employee has walked to the vehicle', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    const v = ctx.state!.vehicles.vehicles[0]!;
    // Vehicle spawns near (16, 16) — the world centre for a 32×32 world (see
    // "move vehicle" test below) — snapped to the nearest cell that's both
    // NavGrid-reachable and on the same bench level as the map's main region
    // (#458 T6.1/D13: NavGridReachability.findNearestReachableCell), so the
    // exact tile can shift by a cell or two depending on terrain.
    expect(Math.abs(v.x - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs(v.z - 16)).toBeLessThanOrEqual(1);

    const eid = hireOne(ctx, 'driver');
    employeeCommand(ctx, ['assign_skill', String(eid)], { skill: 'driving.truck', level: '1' });
    const emp = ctx.state!.employees.employees.find(e => e.id === eid)!;
    // First-hired employee also spawns via the same reachable-cell snap —
    // co-located with the vehicle.
    expect(emp.x).toBe(v.x);
    expect(emp.z).toBe(v.z);

    const result = vehicleCommand(ctx, ['driver', '1', String(eid)], {});
    expect(result.success).toBe(true);
    expect(v.driverId).toBeNull();

    tickCommand(ctx, ['1'], {});
    expect(v.driverId).toBe(eid);
    expectNoWorldInvariantViolations(ctx.state!);
  });

  // ── Movement ──

  it('move vehicle to target coordinates', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    // Vehicle spawns near sizeX/2, sizeZ/2 → (16, 16) for a 32x32 world,
    // snapped to a reachable, same-bench-level cell (#458 T6.1/D13) — see
    // the driverId test above for why this isn't pinned to the exact tile.
    const v = ctx.state!.vehicles.vehicles[0]!;
    expect(Math.abs(v.targetX - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs(v.targetZ - 16)).toBeLessThanOrEqual(1);
    // #947: canTickVehicle now requires a driver aboard to advance on tick at
    // all -- a driverless `vehicle move` is refused outright. This test's own
    // point is that a driven vehicle's move command sets task/target, so give
    // it a real, licensed, co-located driver via the real `vehicle driver`
    // command + a tick to resolve the arrival gate (#1089: the bare
    // `assignDriver` mutator this test used to call sets vehicle.driverId
    // directly but never marks the employee's own Locomotion `mounted` or
    // adds them to occupantIds — Mount.board is the only entry point that
    // keeps those two in agreement (#1087's own module doc comment), and
    // `move`'s own moveTo call below needs a genuinely mounted employee to
    // plan a drive leg through) instead of exercising the driver-gate
    // refusal.
    const eid = hireOne(ctx, 'driver');
    employeeCommand(ctx, ['assign_skill', String(eid)], { skill: 'driving.truck', level: '1' });
    vehicleCommand(ctx, ['driver', '1', String(eid)], {});
    tickCommand(ctx, ['1'], {});
    expect(v.driverId).toBe(eid);

    const result = vehicleCommand(ctx, ['move', '1'], { to: '30,30' });
    expect(result.success).toBe(true);

    // #1089: vehicle.task/targetX/Z are written for display only now
    // (Locomotion.ts's writeVehiclePosition) — `move` installs an itinerary
    // on the driver via moveTo, and the vehicle only reads back as "moving"
    // with the new target once Locomotion actually advances that itinerary
    // a tick, not the instant the command itself returns.
    tickCommand(ctx, ['1'], {});
    expect(v.task).toBe('moving');
    expect(v.targetX).toBe(30);
    expect(v.targetZ).toBe(30);
    expectNoWorldInvariantViolations(ctx.state!);
  });

  // ── Task assignment ──

  it('assign task to vehicle', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    const v = ctx.state!.vehicles.vehicles[0]!;
    expect(v.task).toBe('idle');

    const result = vehicleCommand(ctx, ['assign', '1'], { task: 'transport' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('transport');
    expect(v.task).toBe('transport');
    expectNoWorldInvariantViolations(ctx.state!);
  });

  // ── driveVehicleTowardTarget advances movement (#1089, replaces tickVehicle) ──

  it('driveVehicleTowardTarget advances a boarded vehicle toward its target at the vehicle\'s own tiered speed', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    const v = ctx.state!.vehicles.vehicles[0]!;
    const origX = v.x;
    // Target set relative to the vehicle's actual spawn cell, same row, pure
    // +X — not a hardcoded (16,16)/(20,16) pair (#458 T9.1/D15). The new
    // terrain generator's spawn placement no longer lands exactly on (16,16),
    // and a hardcoded target off by even one z put the path on a real
    // diagonal detour instead of the straight line this test means to check.
    const targetX = origX + 4;
    const targetZ = v.z;
    // #1089: driveVehicleTowardTarget requires an occupant aboard to advance
    // at all — a vehicle with nobody in it never moves, everywhere in the
    // game. Give it a real, licensed, co-located driver (rather than a
    // dangling fake employee id — #1084's assertWorldInvariants flags that as
    // I1_dangling_driver_reference) to exercise the driven-movement path this
    // test means to check.
    const eid = hireOne(ctx, 'driver');
    employeeCommand(ctx, ['assign_skill', String(eid)], { skill: 'driving.truck', level: '1' });
    const assignResult = board(ctx.state!, v.id, eid);
    expect(assignResult.success).toBe(true);
    v.occupantIds = [eid];
    const driver = ctx.state!.employees.employees.find(e => e.id === eid)!;
    driver.locomotion = { kind: 'mounted', vehicleId: v.id };

    // makeCtx() runs new_game, which builds a NavGrid — driveVehicleTowardTarget
    // routes via Pathfinding.findPath and advances at debris_hauler's own
    // speed (3 cells/tick, see VEHICLE_BASE_STATS) rather than a flat 1
    // cell/tick (#407).
    const debrisHaulerSpeed = 3;

    const result = driveVehicleTowardTarget(ctx.state!, v, targetX, targetZ);

    expect(result.arrived).toBe(false);
    expect(v.x).toBe(origX + debrisHaulerSpeed);
    expectNoWorldInvariantViolations(ctx.state!);
  });

  it('driveVehicleTowardTarget does nothing for a vehicle with no occupant', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    const v = ctx.state!.vehicles.vehicles[0]!;
    v.occupantIds = [];
    const origX = v.x;
    const origZ = v.z;

    const result = driveVehicleTowardTarget(ctx.state!, v, origX + 4, origZ);

    expect(result.arrived).toBe(false);
    expect(v.x).toBe(origX);
    expect(v.z).toBe(origZ);
    expectNoWorldInvariantViolations(ctx.state!);
  });

  // ── Vehicle list with driver ──

  it('vehicle list with driver shows driver info', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    const eid = hireOne(ctx, 'driver');
    employeeCommand(ctx, ['assign_skill', String(eid)], { skill: 'driving.truck', level: '1' });
    vehicleCommand(ctx, ['driver', '1', String(eid)], {});
    // Issue #437: driverId is only set once the arrival gate resolves.
    // Boarding is arrival-gated (#437) — employee and vehicle both spawn at
    // (16,16), so one tick resolves the walk (they're already co-located).
    tickCommand(ctx, ['1'], {});

    const result = vehicleCommand(ctx, ['list'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain(`driver:#${eid}`);
    expect(result.output).not.toContain('driver:none');
    expectNoWorldInvariantViolations(ctx.state!);
  });

  // ── Core API: purchaseVehicle / Mount.board / destroyVehicle ──

  it('purchaseVehicle core API returns vehicle and cost', () => {
    const vs = createVehicleState();
    const { vehicle, cost } = purchaseVehicle(vs, 'debris_hauler', 10, 20);

    expect(vehicle.id).toBe(1);
    expect(vehicle.type).toBe('debris_hauler');
    expect(vehicle.x).toBe(10);
    expect(vehicle.z).toBe(20);
    expect(vehicle.task).toBe('idle');
    expect(vehicle.driverId).toBeNull();
    expect(cost).toBeGreaterThan(0);
    expect(vs.vehicles).toHaveLength(1);
  });

  it('Mount.board rejects unlicensed employee', () => {
    const state = createGame({ seed: 42 });
    purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    const rng = new Random(42);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    // blaster has no driving.truck qualification, and is co-located with the
    // vehicle (both default to (0,0)) so the boarding-range check isn't what
    // rejects this attempt.

    const result = board(state, 1, employee.id);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('lacks licence');
    }
  });

  it('Mount.board succeeds with qualified employee', () => {
    const state = createGame({ seed: 42 });
    purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    const rng = new Random(42);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    assignSkill(state.employees, employee.id, 'driving.truck', 1);

    const result = board(state, 1, employee.id);

    expect(result.success).toBe(true);
    expect(state.vehicles.vehicles[0]!.driverId).toBe(employee.id);
  });

  it('destroyVehicle removes vehicle from state', () => {
    const vs = createVehicleState();
    purchaseVehicle(vs, 'drill_rig', 5, 5);
    expect(vs.vehicles).toHaveLength(1);

    const removed = destroyVehicle(vs, 1);
    expect(removed).toBe(true);
    expect(vs.vehicles).toHaveLength(0);
  });

  it('destroyVehicle returns false for non-existent ID', () => {
    const vs = createVehicleState();
    const removed = destroyVehicle(vs, 999);
    expect(removed).toBe(false);
  });

  // ── Vehicle list empty ──

  it('vehicle list returns no-vehicles message when fleet is empty', () => {
    const result = vehicleCommand(ctx, ['list'], {});

    expect(result.success).toBe(true);
    expect(result.output).toBe('No vehicles.');
    expectNoWorldInvariantViolations(ctx.state!);
  });

  // ── getAllVehicleRoles ──

  it('getAllVehicleRoles returns all five roles', () => {
    const roles = getAllVehicleRoles();

    expect(roles).toContain('debris_hauler');
    expect(roles).toContain('rock_digger');
    expect(roles).toContain('drill_rig');
    expect(roles).toContain('building_destroyer');
    expect(roles).toContain('rock_fragmenter');
    expect(roles).toHaveLength(5);
  });

  // ── Buy all types ──

  it('can purchase each vehicle type successfully', () => {
    const types = getAllVehicleRoles();
    for (const type of types) {
      const result = vehicleCommand(ctx, ['buy', type], {});
      expect(result.success, `Buying ${type} should succeed`).toBe(true);
      expect(result.output).toContain(type);
    }
    expect(ctx.state!.vehicles.vehicles).toHaveLength(types.length);
    expectNoWorldInvariantViolations(ctx.state!);
  });

  // ── move without game context ──

  it('vehicle command errors when no game is loaded', () => {
    const emptyCtx: GameContext = makeEmptyGameContext();
    const result = vehicleCommand(emptyCtx, ['list'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });

  // ── assign task with target coordinates ──

  it('assign task with target coords updates both task and target', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    const v = ctx.state!.vehicles.vehicles[0]!;

    const result = vehicleCommand(ctx, ['assign', '1'], { task: 'transport', to: '25,12' });

    expect(result.success).toBe(true);
    expect(v.task).toBe('transport');
    expect(v.targetX).toBe(25);
    expect(v.targetZ).toBe(12);
    expectNoWorldInvariantViolations(ctx.state!);
  });

  // ── getVehicleDef returns tier-1 stats ──

  it('getVehicleDef returns tier-1 stats for each role', () => {
    for (const role of getAllVehicleRoles()) {
      const def = getVehicleDef(role);
      expect(def.type).toBe(role);
      expect(def.tier).toBe(1);
      expect(def.purchaseCost).toBeGreaterThan(0);
      expect(def.maxHp).toBeGreaterThan(0);
      expect(def.speed).toBeGreaterThan(0);
    }
  });

  // ── assign driver rejects already-assigned vehicle ──

  it('assign driver rejects vehicle that already has a driver', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    const eid1 = hireOne(ctx, 'driver');
    employeeCommand(ctx, ['assign_skill', String(eid1)], { skill: 'driving.truck', level: '1' });
    vehicleCommand(ctx, ['driver', '1', String(eid1)], {});
    // Issue #437: driverId is only set once the arrival gate resolves — the
    // first driver must actually board before the "already has a driver"
    // rule can fire for a second request.
    tickCommand(ctx, ['1'], {});
    expect(ctx.state!.vehicles.vehicles[0]!.driverId).toBe(eid1);

    // Hire a second employee
    const rng = new Random(99);
    hireEmployee(ctx.state!.employees, 'driver', rng, 10, 10);
    const eid2 = ctx.state!.employees.employees[1]!.id;
    assignSkill(ctx.state!.employees, eid2, 'driving.truck', 1);

    const result = vehicleCommand(ctx, ['driver', '1', String(eid2)], {});

    expect(result.success).toBe(false);
    expect(result.output).toContain('already has a driver');
    expectNoWorldInvariantViolations(ctx.state!);
  });

  // ── vehicle buy — tier arg (#411) ──

  describe('vehicle buy — tier arg (#411)', () => {
    it('buy with tier:2 purchases a tier-2 vehicle', () => {
      const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '2' });

      expect(result.success).toBe(true);
      const v = ctx.state!.vehicles.vehicles[0]!;
      expect(v.tier).toBe(2);
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('buy with tier:2 deducts the tier-2 cost (not tier-1) from cash', () => {
      const cashBefore = ctx.state!.cash;
      const tier2Def = getVehicleDefByTier('debris_hauler', 2);

      vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '2' });

      expect(ctx.state!.cash).toBe(cashBefore - tier2Def.purchaseCost);
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('buy with tier:3 purchases a tier-3 vehicle at tier-3 cost', () => {
      const cashBefore = ctx.state!.cash;
      const tier3Def = getVehicleDefByTier('drill_rig', 3);

      const result = vehicleCommand(ctx, ['buy', 'drill_rig'], { tier: '3' });

      expect(result.success).toBe(true);
      const v = ctx.state!.vehicles.vehicles[0]!;
      expect(v.tier).toBe(3);
      expect(ctx.state!.cash).toBe(cashBefore - tier3Def.purchaseCost);
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('buy without a tier arg still defaults to tier 1 (backward compatible)', () => {
      vehicleCommand(ctx, ['buy', 'debris_hauler'], {});

      const v = ctx.state!.vehicles.vehicles[0]!;
      expect(v.tier).toBe(1);
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('rejects tier:0 as out of range and does not add a vehicle', () => {
      const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '0' });

      expect(result.success).toBe(false);
      expect(ctx.state!.vehicles.vehicles).toHaveLength(0);
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('rejects tier:9 as out of range and does not add a vehicle', () => {
      const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '9' });

      expect(result.success).toBe(false);
      expect(ctx.state!.vehicles.vehicles).toHaveLength(0);
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('rejects non-numeric tier:abc and does not add a vehicle', () => {
      const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: 'abc' });

      expect(result.success).toBe(false);
      expect(ctx.state!.vehicles.vehicles).toHaveLength(0);
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('does not deduct cash when the tier is rejected', () => {
      const cashBefore = ctx.state!.cash;

      vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '9' });

      expect(ctx.state!.cash).toBe(cashBefore);
      expectNoWorldInvariantViolations(ctx.state!);
    });
  });

  // ── vehicle work-task → working operational state, via the real tick loop (#411) ──

  describe('vehicle work-task → working operational state (#411)', () => {
    it('vehicle.state becomes working after a tick once task is set to a work task', () => {
      vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
      const v = ctx.state!.vehicles.vehicles[0]!;
      expect(v.state).toBe('idle');

      vehicleCommand(ctx, ['assign', '1'], { task: 'transport' });
      expect(v.state).toBe('idle'); // assign alone does not flip state — only the tick loop does

      tickCommand(ctx, ['1'], {});

      expect(v.state).toBe('working');
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('vehicle.state returns to idle after a tick once task returns to idle', () => {
      vehicleCommand(ctx, ['buy', 'rock_digger'], {});
      const v = ctx.state!.vehicles.vehicles[0]!;

      vehicleCommand(ctx, ['assign', '1'], { task: 'loading' });
      tickCommand(ctx, ['1'], {});
      expect(v.state).toBe('working');

      vehicleCommand(ctx, ['assign', '1'], { task: 'idle' });
      tickCommand(ctx, ['1'], {});

      expect(v.state).toBe('idle');
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('each work task (transport, loading, drilling, clearing) drives state to working via the tick loop', () => {
      const workTasks = ['transport', 'loading', 'drilling', 'clearing'];
      for (const task of workTasks) {
        vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
        const id = ctx.state!.vehicles.vehicles[ctx.state!.vehicles.vehicles.length - 1]!.id;
        vehicleCommand(ctx, ['assign', String(id)], { task });

        tickCommand(ctx, ['1'], {});

        const v = ctx.state!.vehicles.vehicles.find(veh => veh.id === id)!;
        expect(v.state, `task=${task} should drive state to working`).toBe('working');
      }
      expectNoWorldInvariantViolations(ctx.state!);
    });
  });

  // ── traffic jam event, driven through the real console tick path (#411) ──
  // detectTrafficJam is unit-tested by direct call elsewhere; this drives it
  // through tickCommand (src/console/commands/events.ts step 8f-2) instead —
  // the real path a console/scenario "tick" step exercises.

  describe('traffic jam event fires via tickCommand (#411)', () => {
    it('sets pendingEvent to traffic_jam once enough vehicles have waited long enough on a shared target', () => {
      // Anchor vehicle occupies the contended target cell. It never ticks
      // (task stays 'idle'), so it just blocks the cell for occupancy checks.
      vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
      const anchor = ctx.state!.vehicles.vehicles[0]!;
      anchor.x = 20;
      anchor.z = 20;
      anchor.targetX = 20;
      anchor.targetZ = 20;
      anchor.task = 'idle';
      anchor.state = 'idle';
      // #1087 follow-up: an idle, unreserved blocker sitting on the
      // contended cell is no longer a permanent obstacle —
      // handleVehicleOccupancyBlock (VehicleOccupancyReroute.ts) now
      // relocates one directly (relocateDriverlessVehicle when driverless,
      // moveVehicle when driven — either shape) the first time any satellite
      // below hits the reroute threshold, which frees the target for every
      // satellite ticked afterward in this SAME tick and starves
      // detectTrafficJam of the >=TRAFFIC_JAM_MIN_VEHICLES simultaneous
      // waiters it needs. Reserving the anchor for a real pending action —
      // with a real, licensed holder driving it, so #1084's I5 check stays
      // clean and `holder.pendingDriverVehicleId` (which ArrivalGate.ts's own
      // per-tick boarding resolution clears unconditionally, succeed or
      // fail, and so cannot be relied on to still read true a tick later)
      // never needs to be the thing that proves validity — keeps it a
      // genuine, unrelocatable obstacle — exactly the shape a real reserved
      // drill_rig/debris_hauler mid-claim would be — matching what this test
      // actually wants to prove instead of accidentally exercising the new
      // relocation feature.
      const anchorHolderRng = new Random(999);
      const { employee: anchorHolder } = hireEmployee(ctx.state!.employees, 'driver', anchorHolderRng, anchor.x, anchor.z);
      assignSkill(ctx.state!.employees, anchorHolder.id, 'driving.truck', 1);
      const anchorAssignResult = board(ctx.state!, anchor.id, anchorHolder.id);
      expect(anchorAssignResult.success).toBe(true);
      const anchorAction: PendingAction = {
        id: 9999,
        type: 'haul_debris',
        requiredSkill: null,
        requiredVehicleRole: 'debris_hauler',
        targetX: anchor.x,
        targetZ: anchor.z,
        targetY: 0,
        payload: {},
        targetEmployeeId: null,
        status: 'assigned',
        holderId: anchorHolder.id,
        queuedAtTick: 0,
      };
      ctx.state!.pendingActions.push(anchorAction);
      anchor.reservedForActionId = anchorAction.id;

      // TRAFFIC_JAM_MIN_VEHICLES vehicles, each one grid step from the
      // anchor's cell (their shared target), already at
      // TRAFFIC_JAM_MIN_TICKS - 1 waiting ticks — one real tickCommand tick
      // finds their path blocked by the anchor and pushes waitingTicks over
      // the threshold, which detectTrafficJam should pick up.
      const neighborOffsets: Array<[number, number]> = [
        [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1],
      ];
      expect(TRAFFIC_JAM_MIN_VEHICLES).toBeLessThanOrEqual(neighborOffsets.length);

      for (let i = 0; i < TRAFFIC_JAM_MIN_VEHICLES; i++) {
        vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
        const v = ctx.state!.vehicles.vehicles[ctx.state!.vehicles.vehicles.length - 1]!;
        const [dx, dz] = neighborOffsets[i]!;
        v.x = 20 + dx;
        v.z = 20 + dz;
        v.targetX = 20;
        v.targetZ = 20;
        v.task = 'moving';
        v.state = 'waiting';
        v.waitingTicks = TRAFFIC_JAM_MIN_TICKS - 1;
        // #947: canTickVehicle now requires a driver aboard to advance on
        // tick at all -- a driverless vehicle's waitingTicks would never
        // reach the threshold this tick, since it never ticks in the first
        // place. Give each waiting hauler a real, licensed, co-located
        // driver (rather than reusing the vehicle's own id as a fake
        // employee id — #1084's assertWorldInvariants flags that as
        // I1_dangling_driver_reference) so the real tick path still pushes
        // them over TRAFFIC_JAM_MIN_TICKS.
        const rng = new Random(100 + i);
        const { employee } = hireEmployee(ctx.state!.employees, 'driver', rng, v.x, v.z);
        assignSkill(ctx.state!.employees, employee.id, 'driving.truck', 1);
        const assignResult = board(ctx.state!, v.id, employee.id);
        expect(assignResult.success).toBe(true);
        // #1089: only an employee moves — tickLocomotion only ever advances
        // an employee's own itinerary, so a driver assigned via assignDriver
        // alone (no occupantIds/locomotion/itinerary) never gets ticked at
        // all. Seat them properly and give them a real drive-leg itinerary
        // toward the shared (20, 20) target — mirroring what moveTo(via:
        // this vehicle) would build for an already-mounted driver — so the
        // real tickLocomotion path is what pushes waitingTicks over the
        // threshold, exactly like every other vehicle-gated test in this file.
        v.occupantIds = [employee.id];
        employee.locomotion = { kind: 'mounted', vehicleId: v.id };
        employee.vehicleWaitingTicks = TRAFFIC_JAM_MIN_TICKS - 1;
        const moveResult = moveTo(ctx.state!, employee.id, { x: 20, z: 20 });
        expect(moveResult.success).toBe(true);
      }

      const result = tickCommand(ctx, ['1'], {});

      expect(result.success).toBe(true);
      expect(ctx.state!.events.pendingEvent).not.toBeNull();
      expect(ctx.state!.events.pendingEvent?.eventId).toBe('traffic_jam');
      expectNoWorldInvariantViolations(ctx.state!);
    });
  });

  // ── Vehicle-gated actions (issue #550) ──
  //
  // `employee dispatch ... vehicle:<role>` already parses and stores
  // requiredVehicleRole on the PendingAction (#550 skeleton), but nothing in
  // the tick loop reserves a vehicle, routes the employee through it, or
  // releases it yet — every test below is Red until VehicleReservation.ts
  // and its callers are implemented.

  describe('Vehicle-gated actions (#550)', () => {
    /** Hire a driller and grant the drill_rig licence on top of their starting 'blasting' skill. */
    function hireLicensedDriller(): number {
      const eid = hireOne(ctx, 'driller');
      employeeCommand(ctx, ['assign_skill', String(eid)], { skill: 'driving.drill_rig', level: '1' });
      return eid;
    }

    it('walks to the vehicle, boards, drives, works, and completes — XP granted, action removed, vehicle released and driver dismounted', () => {
      const eid = hireLicensedDriller();
      vehicleCommand(ctx, ['buy', 'drill_rig'], {});
      const vehicle = ctx.state!.vehicles.vehicles[0]!;
      const emp = ctx.state!.employees.employees.find(e => e.id === eid)!;
      const xpBefore = emp.qualifications.find(q => q.category === 'blasting')!.xp;

      const dispatch = employeeCommand(ctx, ['dispatch', String(eid)], { x: '20', z: '20', skill: 'blasting', vehicle: 'drill_rig' });
      expect(dispatch.success).toBe(true);
      const actionId = ctx.state!.pendingActions[0]!.id;

      let sawBoarded = false;
      for (let i = 0; i < 200 && ctx.state!.pendingActions.some(a => a.id === actionId); i++) {
        tickCommand(ctx, ['1'], {});
        if (vehicle.driverId === eid) sawBoarded = true;
      }

      // The driller must actually have boarded the reserved vehicle at some
      // point before the action completed — not just walked there on foot.
      expect(sawBoarded).toBe(true);
      expect(ctx.state!.pendingActions.find(a => a.id === actionId)).toBeUndefined();
      const xpAfter = emp.qualifications.find(q => q.category === 'blasting')!.xp;
      expect(xpAfter).toBeGreaterThan(xpBefore);
      expect(vehicle.reservedForActionId).toBeNull();
      expect(vehicle.driverId).toBeNull();
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('a same-role follow-up action keeps the driller mounted in the same vehicle instead of dismounting and re-walking', () => {
      const eid = hireLicensedDriller();
      // Master-level 'blasting' (proficiency 5, ×0.40 duration multiplier) —
      // this test is about mount continuity across a claim, not about task
      // duration, so it keeps both dispatches' combined drive+work time well
      // under the ~50-tick fatigue-collapse ceiling ((100 - NEED_HARD_THRESHOLDS.fatigue)
      // / NEED_DRAIN_RATES.fatigue.working, balance.ts — threshold is 0, #1062).
      // At Rookie level 1 the
      // two BASE_TASK_DURATION_TICKS=20 dispatches alone sum to ~48 ticks
      // before any drive time, so a needs-driven rest interruption — which
      // legitimately dismounts the driver (TaskDispatch.interruptActiveAction
      // releases a vehicle-gated reservation on interrupt, same as
      // cancellation) — would fire independently of, and mask, the mount-
      // continuity behavior this test targets.
      employeeCommand(ctx, ['assign_skill', String(eid)], { skill: 'blasting', level: '5' });
      vehicleCommand(ctx, ['buy', 'drill_rig'], {});
      const vehicle = ctx.state!.vehicles.vehicles[0]!;

      employeeCommand(ctx, ['dispatch', String(eid)], { x: '15', z: '15', skill: 'blasting', vehicle: 'drill_rig' });
      const firstActionId = ctx.state!.pendingActions[0]!.id;
      employeeCommand(ctx, ['dispatch', String(eid)], { x: '25', z: '25', skill: 'blasting', vehicle: 'drill_rig' });
      const secondActionId = ctx.state!.pendingActions.find(a => a.id !== firstActionId)!.id;

      let sawBoardedForFirst = false;
      for (let i = 0; i < 200 && ctx.state!.pendingActions.some(a => a.id === firstActionId); i++) {
        tickCommand(ctx, ['1'], {});
        if (vehicle.driverId === eid) sawBoardedForFirst = true;
      }
      expect(sawBoardedForFirst).toBe(true);

      // The follow-up claims the same vehicle via the continuity tie-break
      // (findFreeVehicleForRole) — driverId must never drop back to null in
      // between the two actions.
      let sawUnmounted = false;
      for (let i = 0; i < 200 && ctx.state!.pendingActions.some(a => a.id === secondActionId); i++) {
        if (vehicle.driverId !== eid) sawUnmounted = true;
        tickCommand(ctx, ['1'], {});
      }

      expect(sawUnmounted).toBe(false);
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('cancelling a vehicle-gated action mid-walk-to-vehicle releases the vehicle reservation and clears the dangling boarding request', () => {
      const eid = hireLicensedDriller();
      vehicleCommand(ctx, ['buy', 'drill_rig'], {});
      const vehicle = ctx.state!.vehicles.vehicles[0]!;
      const emp = ctx.state!.employees.employees.find(e => e.id === eid)!;

      employeeCommand(ctx, ['dispatch', String(eid)], { x: '20', z: '20', skill: 'blasting', vehicle: 'drill_rig' });
      const actionId = ctx.state!.pendingActions[0]!.id;

      // Simulate the mid-walk-to-vehicle state the real claim path will
      // produce once implemented (claimed, reserved, still walking to the
      // vehicle) — the claim path itself isn't wired yet, so this is set up
      // directly rather than reached by ticking.
      ctx.state!.pendingActions[0]!.status = 'assigned';
      ctx.state!.pendingActions[0]!.holderId = eid;
      emp.activeActionId = actionId;
      vehicle.reservedForActionId = actionId;
      emp.pendingDriverVehicleId = vehicle.id;

      const cancel = employeeCommand(ctx, ['cancel', String(actionId)], {});
      expect(cancel.success).toBe(true);

      expect(vehicle.reservedForActionId).toBeNull();
      expect(emp.pendingDriverVehicleId).toBeNull();
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('clears the vehicle reservation and driver when the holder dies mid-drive', () => {
      const eid = hireLicensedDriller();
      vehicleCommand(ctx, ['buy', 'drill_rig'], {});
      const vehicle = ctx.state!.vehicles.vehicles[0]!;
      const emp = ctx.state!.employees.employees.find(e => e.id === eid)!;

      employeeCommand(ctx, ['dispatch', String(eid)], { x: '20', z: '20', skill: 'blasting', vehicle: 'drill_rig' });
      const actionId = ctx.state!.pendingActions[0]!.id;

      // Simulate "boarded, mid-drive" — reservation held, driver aboard,
      // work timer not yet started.
      ctx.state!.pendingActions[0]!.status = 'in_progress';
      ctx.state!.pendingActions[0]!.holderId = eid;
      emp.activeActionId = actionId;
      vehicle.driverId = eid;
      vehicle.occupantIds = [eid];
      emp.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
      vehicle.reservedForActionId = actionId;
      emp.taskTicksRemaining = null;

      killEmployee(ctx.state!.employees, eid);
      tickCommand(ctx, ['1'], {});

      expect(vehicle.reservedForActionId).toBeNull();
      expect(vehicle.driverId).toBeNull();
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('destroying the reserved vehicle mid-drive returns the action to "queued", re-claimable by a different qualified employee/vehicle pair', () => {
      const eid1 = hireLicensedDriller();
      vehicleCommand(ctx, ['buy', 'drill_rig'], {});
      const vehicle1 = ctx.state!.vehicles.vehicles[0]!;
      const emp1 = ctx.state!.employees.employees.find(e => e.id === eid1)!;

      employeeCommand(ctx, ['dispatch', String(eid1)], { x: '20', z: '20', skill: 'blasting', vehicle: 'drill_rig' });
      const actionId = ctx.state!.pendingActions[0]!.id;

      // Simulate "boarded, mid-drive" on vehicle1.
      ctx.state!.pendingActions[0]!.status = 'assigned';
      ctx.state!.pendingActions[0]!.holderId = eid1;
      emp1.activeActionId = actionId;
      vehicle1.driverId = eid1;
      vehicle1.reservedForActionId = actionId;
      emp1.taskTicksRemaining = null;

      destroyVehicle(ctx.state!.vehicles, vehicle1.id);

      // A second qualified driller + drill_rig, available to reclaim the
      // action once it's released back to the pool.
      const rng = new Random(7);
      hireEmployee(ctx.state!.employees, 'driller', rng, 40, 40);
      const eid2 = ctx.state!.employees.employees.find(e => e.id !== eid1)!.id;
      assignSkill(ctx.state!.employees, eid2, 'driving.drill_rig', 1);
      purchaseVehicle(ctx.state!.vehicles, 'drill_rig', 40, 40);

      let sawQueued = false;
      for (let i = 0; i < 50; i++) {
        tickCommand(ctx, ['1'], {});
        const action = ctx.state!.pendingActions.find(a => a.id === actionId);
        if (action && action.status === 'queued') sawQueued = true;
      }

      expect(sawQueued).toBe(true);
      // #1096: the re-pinned action can be reclaimed onto emp1 while emp1 is
      // resting (collapsed mid-walk to the newly-available vehicle) —
      // tickCollapse must release that taskQueue-held reservation too, or it
      // sits stale (I5_reservation_without_valid_holder) for the whole rest.
      expectNoWorldInvariantViolations(ctx.state!);
    });
  });

  // ── Vehicle-gated boarding via moveTo (#1089) ──────────────────────────────
  // Rewrites the old requestBoardVehicle/console-`vehicle driver`-shaped
  // boarding flow onto the new mount/itinerary model: an employee dispatched
  // to board a vehicle ends up walking there and boarding via a
  // moveTo({vehicleId})-shaped itinerary, resolved entirely by repeated
  // tickLocomotion calls — no console tick, no requestBoardVehicle.

  describe('Vehicle-gated boarding via moveTo (#1089)', () => {
    let seedCounter = 500;

    function hireLicensedDigger(x = 0, z = 0): number {
      const rng = new Random(seedCounter++);
      const { employee } = hireEmployee(ctx.state!.employees, 'driller', rng, x, z);
      employeeCommand(ctx, ['assign_skill', String(employee.id)], { skill: 'driving.excavator', level: '1' });
      return employee.id;
    }

    it('moveTo({vehicleId}) walks an on-foot driller to a rock_digger and boards it, resolved by tickLocomotion alone', () => {
      vehicleCommand(ctx, ['buy', 'rock_digger'], {});
      const vehicle = ctx.state!.vehicles.vehicles[0]!;
      // Placed a few cells away from the vehicle's own spawn so a genuine
      // foot leg is required before boarding — not an instant same-cell board.
      const eid = hireLicensedDigger(vehicle.x + 5, vehicle.z + 5);
      const emp = ctx.state!.employees.employees.find(e => e.id === eid)!;

      const result = moveTo(ctx.state!, eid, { vehicleId: vehicle.id });
      expect(result.success).toBe(true);
      expect(emp.itinerary).not.toBeNull();

      let boarded = false;
      for (let i = 0; i < 30 && !boarded; i++) {
        tickLocomotion(ctx.state!);
        boarded = vehicle.occupantIds.includes(eid);
      }

      expect(boarded).toBe(true);
      expect(emp.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
      expect(emp.x).toBe(vehicle.x);
      expect(emp.z).toBe(vehicle.z);
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('moveTo({vehicleId}) refuses (success:false) when the vehicle is already occupied by another employee, and boards nobody new', () => {
      vehicleCommand(ctx, ['buy', 'rock_digger'], {});
      const vehicle = ctx.state!.vehicles.vehicles[0]!;
      const firstId = hireLicensedDigger(vehicle.x, vehicle.z);
      vehicle.occupantIds = [firstId];
      vehicle.driverId = firstId;
      const first = ctx.state!.employees.employees.find(e => e.id === firstId)!;
      first.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

      const secondId = hireLicensedDigger(vehicle.x + 3, vehicle.z);

      const result = moveTo(ctx.state!, secondId, { vehicleId: vehicle.id });

      expect(result.success).toBe(false);
      expect(vehicle.occupantIds).toEqual([firstId]);
      expectNoWorldInvariantViolations(ctx.state!);
    });
  });

  // ── A vehicle is never advanced twice in one tick (#1089) ──────────────────
  // The issue's own core regression test: under the pre-#1089 code, a
  // vehicle's position could be touched by more than one call site in the
  // same runTick — the plain vehicle-movement loop (TickPipeline.ts step 8f),
  // the hauling to_depot phase (HaulingTask.ts's own driveTowardFragment-style
  // driving), and the arrival-gate boarding/drive resolution (ArrivalGate.ts)
  // each independently advanced a vehicle's x/z; TickPipeline.ts's own step 8f
  // comment ("ticking them here too would move them twice in the same tick")
  // is the guard that shape of bug needed under the old, three-mover design.
  // #1089 replaces every one of those call sites with the single
  // tickLocomotion step — this proves a vehicle advances by exactly one leg's
  // worth of movement per tick, even when old-style flags that used to gate a
  // second, independent drive (haulingPhase, reservedForActionId) are still
  // set on it.

  describe('a vehicle is never advanced twice in one tick (#1089)', () => {
    it('advances a mounted driller\'s vehicle by exactly one leg\'s worth of movement per tick, never double', () => {
      const eid = hireOne(ctx, 'driller');
      employeeCommand(ctx, ['assign_skill', String(eid)], { skill: 'driving.drill_rig', level: '1' });
      vehicleCommand(ctx, ['buy', 'drill_rig'], {});
      const vehicle = ctx.state!.vehicles.vehicles[0]!;

      const boardResult = moveTo(ctx.state!, eid, { vehicleId: vehicle.id });
      expect(boardResult.success).toBe(true);
      for (let i = 0; i < 50 && !vehicle.occupantIds.includes(eid); i++) {
        tickCommand(ctx, ['1'], {});
      }
      expect(vehicle.occupantIds).toContain(eid);

      // #1103: clamped to the live NavGrid's own east edge rather than a
      // flat `+20` — PlanItinerary.ts's estimateLegDistance now refuses a
      // leg whose real pathfound endpoint would silently clamp away from
      // its own requested destination (Pathfinding.ts's clampToGrid), so an
      // unconditional `vehicle.x + 20` genuinely off this test's 32-wide
      // grid (spawn position dependent — a driller's spawn cell isn't
      // pinned) started failing outright instead of installing a leg that
      // could never arrive. Still "far" relative to the vehicle's own
      // starting cell, which is all this test's own overlap-guard below needs.
      const farX = Math.min(vehicle.x + 20, ctx.state!.navGrid!.maxX - 1);
      const farZ = vehicle.z;
      const moveResult = moveTo(ctx.state!, eid, { x: farX, z: farZ });
      expect(moveResult.success).toBe(true);

      // The exact overlap shape the old, three-mover code allowed: a
      // hauling-style phase flag AND a vehicle-gated reservation, both set on
      // the SAME vehicle the employee is now driving via their itinerary.
      // Under the pre-#1089 design, either flag alone routed this vehicle
      // through a second, independent drive call in the same tick.
      vehicle.haulingPhase = 'to_depot';
      vehicle.reservedForActionId = 999999;

      const speed = getVehicleDefByTier(vehicle.type, vehicle.tier).speed;
      const beforeX = vehicle.x;
      const beforeZ = vehicle.z;

      tickCommand(ctx, ['1'], {});

      const dx = vehicle.x - beforeX;
      const dz = vehicle.z - beforeZ;
      const distance = Math.sqrt(dx * dx + dz * dz);

      // Exactly one leg's worth of travel this tick — a second, independent
      // mover touching the same vehicle would show roughly double this
      // distance (or an inconsistent position entirely), not this bound.
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThanOrEqual(speed + 0.001);
      expectNoWorldInvariantViolations(ctx.state!);
    });
  });

  // ── #922: a driven employee's position tracks the vehicle continuously,
  // and dismount (interruption for shift rest, then resume) never sends them
  // back to — or through — the cell they originally boarded at.
  describe("driver position invariant — never frozen at the boarding cell, never revisits it on interruption/resume (#922)", () => {
    it('walks to the vehicle, boards, drives (tracked every tick), gets interrupted for shift rest mid-drive, and resumes — no leg of the walk ever returns to or targets the original boarding cell', () => {
      // processShiftCycle (ForceShiftRest.ts's dismount path) is a no-op with
      // neither a site policy nor a tier>=2 living_quarters on site (its own
      // `!policyApplied && !hasBunkhouse` early return) — a tier-2 bunkhouse
      // tucked in the far corner (well clear of hire/vehicle-spawn near grid
      // centre and the (25,25) dispatch target) is what actually arms the
      // WORK_DURATION_TICKS-triggered interruption this test forces below.
      ctx.state!.buildings.unlockedTiers.living_quarters = 3;
      placeBuilding(ctx.state!.buildings, 'living_quarters', 0, 0, 100, 100, 2);

      const eid = hireOne(ctx, 'driller');
      employeeCommand(ctx, ['assign_skill', String(eid)], { skill: 'driving.drill_rig', level: '1' });
      vehicleCommand(ctx, ['buy', 'drill_rig'], {});
      const vehicle = ctx.state!.vehicles.vehicles[0]!;
      const emp = ctx.state!.employees.employees.find(e => e.id === eid)!;

      const dispatch = employeeCommand(ctx, ['dispatch', String(eid)], { x: '25', z: '25', skill: 'blasting', vehicle: 'drill_rig' });
      expect(dispatch.success).toBe(true);
      const actionId = ctx.state!.pendingActions[0]!.id;

      // Drive to boarding, sampling every tick until aboard.
      let boardingX: number | null = null;
      let boardingZ: number | null = null;
      for (let i = 0; i < 200 && boardingX === null; i++) {
        tickCommand(ctx, ['1'], {});
        if (vehicle.driverId === eid) {
          boardingX = vehicle.x;
          boardingZ = vehicle.z;
        }
      }
      expect(boardingX).not.toBeNull();

      // Mid-drive: the driver's logical position must track the vehicle
      // every tick — no console command stands in for this; findDrivenVehicle
      // (EmployeeActivity.ts, #922) is the lookup computeEmployeeActivity
      // uses to report this employee as driving.
      let sawOffBoardingCell = false;
      for (let i = 0; i < 6; i++) {
        tickCommand(ctx, ['1'], {});
        if (vehicle.driverId !== eid) break; // arrived/dismounted early — handled below
        const driven = findDrivenVehicle(eid, ctx.state!.vehicles.vehicles);
        expect(driven).not.toBeNull();
        expect(driven!.id).toBe(vehicle.id);
        expect(emp.x).toBe(vehicle.x);
        expect(emp.z).toBe(vehicle.z);
        if (emp.x !== boardingX || emp.z !== boardingZ) sawOffBoardingCell = true;
      }
      expect(sawOffBoardingCell).toBe(true);

      // Force a shift-rest interruption right now, mid-drive — mirrors a
      // genuine WORK_DURATION_TICKS-triggered interruption (ForceShiftRest.ts)
      // without needing to time the drive to it exactly.
      emp.ticksWorked = WORK_DURATION_TICKS;
      tickCommand(ctx, ['1'], {});

      // Dismounted — and never at the original boarding cell, since the
      // vehicle had already moved on by the time the interruption landed.
      expect(vehicle.driverId).toBeNull();
      expect(emp.x === boardingX && emp.z === boardingZ).toBe(false);

      // Resume: rest completes, the driller reclaims the same action, and
      // drives on to finish it. Across every remaining tick, neither the
      // employee's live position nor their walk destination ever equals the
      // original boarding cell.
      let sawBoardingCellRevisited = false;
      for (let i = 0; i < 400 && ctx.state!.pendingActions.some(a => a.id === actionId); i++) {
        tickCommand(ctx, ['1'], {});
        if (emp.x === boardingX && emp.z === boardingZ) sawBoardingCellRevisited = true;
        if (emp.destinationX === boardingX && emp.destinationZ === boardingZ) sawBoardingCellRevisited = true;
      }

      expect(sawBoardingCellRevisited).toBe(false);
      // #1110: a long enough resume window (400 ticks) recrosses
      // WORK_DURATION_TICKS again — the shift-rest interruption path
      // (ForceShiftRest.ts) must release the reservation of an action still
      // sitting unboarded in the interrupted employee's taskQueue, the same
      // way #1096/#1107 already made tickCollapse do for a `collapsing`
      // employee.
      expectNoWorldInvariantViolations(ctx.state!);
    });
  });

  // ── #921: player-facing driver assignment removed — the fully automatic
  // claim/board/release path already exists in core (VehicleReservation.ts,
  // VehicleBoarding.ts, ArrivalGate.resolveBoarding) and needs no changes for
  // this issue. These two tests pin that no manual affordance
  // (`vehicleCommand(['driver', ...])` / `Mount.board`) is ever needed for a
  // queued vehicle-gated task to claim, board, and complete on its own.
  describe('fully automatic driver claim — no player affordance used (#921)', () => {
    it('a bought vehicle + a licensed, idle employee + a queued vehicle-gated action: driverId is set to that employee and the action progresses with zero manual "vehicle driver"/Mount.board calls', () => {
      const eid = hireOne(ctx, 'driller');
      employeeCommand(ctx, ['assign_skill', String(eid)], { skill: 'driving.drill_rig', level: '1' });
      vehicleCommand(ctx, ['buy', 'drill_rig'], {});
      const vehicle = ctx.state!.vehicles.vehicles[0]!;

      // Nothing below this line ever calls vehicleCommand(['driver', ...]) or
      // the core Mount.board() function — the claim has to happen on its own.
      const dispatch = employeeCommand(ctx, ['dispatch', String(eid)], { x: '20', z: '20', skill: 'blasting', vehicle: 'drill_rig' });
      expect(dispatch.success).toBe(true);
      const actionId = ctx.state!.pendingActions[0]!.id;

      let sawDriverSet = false;
      for (let i = 0; i < 200 && ctx.state!.pendingActions.some(a => a.id === actionId); i++) {
        tickCommand(ctx, ['1'], {});
        if (vehicle.driverId === eid) sawDriverSet = true;
      }

      expect(sawDriverSet).toBe(true);
      // The action progressed all the way to completion — removed from the
      // pending pool, with the vehicle released again.
      expect(ctx.state!.pendingActions.find(a => a.id === actionId)).toBeUndefined();
      expectNoWorldInvariantViolations(ctx.state!);
    });

    it('two licensed employees queued for the same vehicle role with only one free vehicle: only one boards at a time, the other claims it once released', () => {
      const eid1 = hireOne(ctx, 'driller');
      employeeCommand(ctx, ['assign_skill', String(eid1)], { skill: 'driving.drill_rig', level: '1' });
      const rng = new Random(11);
      hireEmployee(ctx.state!.employees, 'driller', rng, 16, 16);
      const eid2 = ctx.state!.employees.employees.find(e => e.id !== eid1)!.id;
      assignSkill(ctx.state!.employees, eid2, 'driving.drill_rig', 1);

      // Exactly one free drill_rig for both to compete over.
      vehicleCommand(ctx, ['buy', 'drill_rig'], {});
      const vehicle = ctx.state!.vehicles.vehicles[0]!;

      const dispatch1 = employeeCommand(ctx, ['dispatch', String(eid1)], { x: '10', z: '10', skill: 'blasting', vehicle: 'drill_rig' });
      expect(dispatch1.success).toBe(true);
      const actionId1 = ctx.state!.pendingActions[0]!.id;
      const dispatch2 = employeeCommand(ctx, ['dispatch', String(eid2)], { x: '30', z: '30', skill: 'blasting', vehicle: 'drill_rig' });
      expect(dispatch2.success).toBe(true);
      const actionId2 = ctx.state!.pendingActions.find(a => a.id !== actionId1)!.id;

      // Tick until both actions have resolved, sampling the vehicle's driver
      // on every tick. There is only one drill_rig, so at no point may it
      // simultaneously be driven by both employees (it can only ever hold
      // one driverId at a time) — the second driller has to wait for the
      // first to finish and release it.
      const driversSeen = new Set<number>();
      for (let i = 0; i < 400 && (ctx.state!.pendingActions.some(a => a.id === actionId1) || ctx.state!.pendingActions.some(a => a.id === actionId2)); i++) {
        tickCommand(ctx, ['1'], {});
        if (vehicle.driverId !== null) driversSeen.add(vehicle.driverId);
      }

      // Both employees eventually drove the shared vehicle, one after the
      // other — proving the second one queued behind the first rather than
      // being rejected outright or somehow sharing the vehicle concurrently.
      expect(driversSeen.has(eid1)).toBe(true);
      expect(driversSeen.has(eid2)).toBe(true);
      expect(ctx.state!.pendingActions.find(a => a.id === actionId1)).toBeUndefined();
      expect(ctx.state!.pendingActions.find(a => a.id === actionId2)).toBeUndefined();
      expectNoWorldInvariantViolations(ctx.state!);
    });
  });
});

// ── Occupancy-block reroute/stuck escalation — end-to-end repro (issue #591) ──
// The issue's console repro: a staffed site's drill_rig, auto-dispatched
// toward a 5×5 drill pattern, could park forever behind another staffed
// vehicle spawned only 2 cells away — no reroute, no escalation to
// isMoveStuck, invisible to detectTrafficJam (which needs 3+ vehicles). Drives
// the real command layer (not the lower-level tickVehicle/EntityMovementTick
// APIs the unit tests above use) so this also proves the fix reaches players
// through the console, not just the engine function directly.
//
// Ticks one at a time (rather than a single `tick 100`) and samples every
// tick: the needs system periodically interrupts the drive to force a rest,
// which cycles the rig back through idle — so the bug (permanently 'waiting'
// past the reroute threshold with isMoveStuck still false) can be present at
// tick 47 and gone by the single-shot snapshot at tick 100 purely because the
// rig happens to be mid-rest right then. Sampling every tick catches the
// defect at the moment it actually occurs, not just at one snapshot.

describe('vehicle occupancy reroute / stuck escalation — end-to-end repro (issue #591)', () => {
  it('rig #1 is never left permanently "waiting" past the reroute threshold without either escalating to isMoveStuck or getting moving again, over the first 100 ticks', () => {
    const engine = createRunner();

    expect(runCommand(engine, 'campaign start level:dusty_hollow staffed:true').success).toBe(true);
    expect(runCommand(engine, 'drill_plan grid rows:5 cols:5 spacing:3 depth:6 start:5,5').success).toBe(true);

    // The exact bug this issue fixes: still 'waiting' behind a permanently
    // occupied next cell, having waited past the reroute-escalation
    // threshold, with isMoveStuck never having flipped true either. A fixed
    // engine either gets the vehicle moving again (reroute succeeded) or
    // gives up cleanly and reports isMoveStuck — never silently parks forever.
    let sawUnescalatedOverThreshold = false;
    for (let i = 0; i < 100; i++) {
      expect(runCommand(engine, 'tick 1').success).toBe(true);
      const rig = engine.ctx.state!.vehicles.vehicles.find(v => v.id === 1)!;
      if (rig.state === 'waiting' && rig.waitingTicks >= VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 1 && !rig.isMoveStuck) {
        sawUnescalatedOverThreshold = true;
      }
    }

    expect(sawUnescalatedOverThreshold).toBe(false);
    expectNoWorldInvariantViolations(engine.ctx.state!);
  });
});

// ── Sustained-stuck release for a vehicle-gated task (#986) ────────────────
// End-to-end repro through the real console `tick` command (not the lower-
// level tickVehicle/EntityMovementTick APIs the unit tests use directly):
// a debris_hauler driven toward a target inside a sheer, unramped blast
// crater interior — the exact "climb-limit gating" shape from
// navmesh.integration.test.ts's own "crater + climb-limit gating (#953)"
// fixture's "same crater with NO ramp dug" case — can never findPath in.
// Before this fix, tickVehicleOnNavGrid had no sustained-stuck release for
// this (unlike tickEmployeeMovement's on-foot MOVE_STUCK_ABANDON_TICKS
// release, #938): the vehicle just called markVehicleWaiting forever, and
// the driver's claimed task/vehicle reservation was never freed for anyone
// else to pick up.
//
// Uses a hand-built PendingAction (type 'general_work', requiredVehicleRole:
// 'debris_hauler') driven through GameLoop's own plain vehicle-movement step
// (tickCommand's step 8f) rather than a full blast -> fragment ->
// syncHaulDispatch -> auto-claim -> haul_debris pipeline: the regression this
// covers lives entirely inside tickVehicleOnNavGrid, which every
// vehicle-gated task's drive phase shares regardless of the specific
// PendingAction type driving it (a real haul_debris drive-to-fragment phase
// calls the very same tickVehicle, via HaulingTask.tickHaulingProgress's own
// driveTowardFragment) — hand-rolling the full fragment/depot machinery would
// add setup unrelated to the code path actually under test.

describe('tickVehicle — sustained-stuck release for a vehicle-gated task inside an unreachable blast crater (#986)', () => {
  const CRATER_MIN_X = 7, CRATER_MAX_X = 13, CRATER_MIN_Z = 15, CRATER_MAX_Z = 22;
  const SURFACE_Y = 22;
  const CRATER_FLOOR_Y = 14;

  function solidVoxel() {
    return { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
  }

  /** Fill every column with solid rock from y=0 to yMax (inclusive). */
  function fillSolid(grid: VoxelGrid, yMax: number) {
    for (let x = 0; x < grid.sizeX; x++)
      for (let y = 0; y <= yMax; y++)
        for (let z = 0; z < grid.sizeZ; z++)
          grid.setVoxel(x, y, z, solidVoxel());
  }

  /**
   * Same fixture shape as navmesh.integration.test.ts's "crater + climb-limit
   * gating (#953)" describe block's "same crater with NO ramp dug" test: a
   * flat plateau with a rectangular crater carved sheer down to
   * CRATER_FLOOR_Y, no gradual ramp anywhere on its perimeter — the interior
   * is permanently unreachable from the surface.
   */
  function buildCraterVoxelGrid(): VoxelGrid {
    const grid = new VoxelGrid(20, 30, 30);
    fillSolid(grid, SURFACE_Y);
    for (let z = CRATER_MIN_Z; z <= CRATER_MAX_Z; z++) {
      for (let x = CRATER_MIN_X; x <= CRATER_MAX_X; x++) {
        for (let y = CRATER_FLOOR_Y + 1; y <= SURFACE_Y; y++) grid.clearVoxel(x, y, z);
      }
    }
    return grid;
  }

  /** Minimal PendingAction fixture — mirrors this suite's own hand-rolled shape elsewhere. */
  function makeVehicleGatedAction(overrides: Partial<PendingAction> & { id: number }): PendingAction {
    return {
      type: 'general_work',
      requiredSkill: null,
      requiredVehicleRole: 'debris_hauler',
      targetX: 10, targetZ: 21, targetY: CRATER_FLOOR_Y,
      payload: {},
      targetEmployeeId: null,
      status: 'assigned',
      holderId: null,
      queuedAtTick: overrides.queuedAtTick ?? 0,
      ...overrides,
    };
  }

  function buildCtx(): GameContext {
    const grid = buildCraterVoxelGrid();
    const state = createGame({ seed: 42 });
    state.navGrid = NavGrid.buildNavGrid(grid, [], []);
    state.cash = 1_000_000;
    return makeEmptyGameContext({ state, grid });
  }

  /**
   * A bare single-drive-leg itinerary toward (x, z), installed directly on an
   * already-mounted employee — bypasses moveTo/planItinerary's own 'exact'
   * fidelity reachability refusal (#1089: planItinerary returns null for a
   * genuinely unreachable target, which a real dispatch would just never
   * offer in the first place), so a target that BECOMES unreachable after a
   * real vehicle-gated claim (this describe block's whole premise, #986) can
   * still be driven at — and stall out into — by the real
   * tickLocomotion/advanceLeg executor, which discovers unreachability over
   * time rather than up front.
   */
  function installDriveItinerary(driver: Employee, vehicleId: number, x: number, z: number): void {
    const leg: Leg = {
      mode: 'drive', vehicleId, destX: x, destZ: z, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 0,
    };
    driver.itinerary = { legs: [leg], goal: { kind: 'reposition', x, z }, workTicks: 0, estTotalTicks: 0 };
  }

  it('releases the driver\'s claim and frees the vehicle within MOVE_STUCK_ABANDON_TICKS ticks, then completes a second, different, reachable task afterward', () => {
    const ctx = buildCtx();
    const state = ctx.state!;
    const rng = new Random(42);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 10, 5);

    const action = makeVehicleGatedAction({ id: 9001, holderId: driver.id });
    state.pendingActions.push(action);
    vehicle.driverId = driver.id;
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 10;
    vehicle.targetZ = 21; // crater floor — unreachable, no ramp dug
    // A real vehicle-gated claim always sets this at claim time
    // (findFreeVehicleForRole/promoteVehicleGatedAction) — releaseVehicleReservation
    // (called from within interruptActiveAction) looks the vehicle up by this
    // field, not by driverId, so leaving it unset would silently no-op the
    // vehicle-side dismount on sustained-stuck release.
    vehicle.reservedForActionId = action.id;
    driver.activeActionId = action.id;
    // #1089: only an employee moves — tickLocomotion only ever advances an
    // employee's own itinerary, so a driver mounted via the raw field pokes
    // above (no itinerary) would never get ticked at all. Install a bare
    // drive-leg itinerary directly (installDriveItinerary, above) rather than
    // through moveTo/planItinerary, whose own 'exact' fidelity would refuse
    // to plan a route to a target it can already tell is unreachable — this
    // test means to prove the executor's own sustained-stuck-abandon
    // escalation, discovered over time, not the planner's upfront refusal.
    installDriveItinerary(driver, vehicle.id, vehicle.targetX, vehicle.targetZ);

    let releasedAtTick = -1;
    for (let i = 1; i <= MOVE_STUCK_ABANDON_TICKS + 5; i++) {
      tickCommand(ctx, ['1'], {});
      if (vehicle.driverId === null) {
        releasedAtTick = i;
        break;
      }
    }

    expect(releasedAtTick).toBeGreaterThan(0);
    expect(releasedAtTick).toBeLessThanOrEqual(MOVE_STUCK_ABANDON_TICKS);

    expect(vehicle.task).toBe('idle');
    expect(vehicle.state).toBe('idle');
    expect(vehicle.moveConsecutiveFailures).toBe(0);
    expect(vehicle.isMoveStuck).toBe(false);

    const releasedAction = state.pendingActions.find(a => a.id === 9001)!;
    expect(releasedAction.status).toBe('queued');
    expect(releasedAction.holderId).toBeNull();

    // Not frozen permanently: the same vehicle, re-boarded by the same
    // driver, is now sent on a second, different, reachable task — outside
    // the crater entirely — and must actually arrive.
    const action2 = makeVehicleGatedAction({ id: 9002, holderId: driver.id, targetX: 15, targetZ: 5 });
    state.pendingActions.push(action2);
    vehicle.driverId = driver.id;
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 15;
    vehicle.targetZ = 5;
    driver.activeActionId = action2.id;
    // #1089: same reasoning as the first drive above — a real itinerary is
    // what tickLocomotion actually walks.
    installDriveItinerary(driver, vehicle.id, vehicle.targetX, vehicle.targetZ);

    let arrived = false;
    for (let i = 0; i < 60; i++) {
      tickCommand(ctx, ['1'], {});
      const currentTask = vehicle.task as VehicleTask;
      if (vehicle.x === 15 && vehicle.z === 5 && currentTask === 'idle') {
        arrived = true;
        break;
      }
    }

    expect(arrived).toBe(true);
    expect(vehicle.isMoveStuck).toBe(false);
    expectNoWorldInvariantViolations(state);
  });
});

// ── #924: dig_ramp_segment work duration scales with live voxel count ──────
//
// The full tickArrivalGate -> seedTaskTimerFields -> computeActionWorkTicks
// chain, driven entirely through the console (new_game/build_ramp/tick),
// mirrors what a real playthrough exercises. Two identical ramp orders (same
// seed, same origin/direction/length/depth, so the order-time
// segment.cells.length is identical for both) diverge only in that one has
// half its first segment's own cells cleared directly in the live grid AFTER
// ordering — simulating an overlapping blast or ramp having already carved
// part of the segment before the digger starts. Today's stub (#924 skeleton)
// ignores `grid` for dig_ramp_segment entirely, so it seeds the identical
// work-timer duration for both; the fix must seed a shorter one for the
// partly-cleared segment.

describe('dig_ramp_segment work duration scales with live voxel count (#924)', () => {
  it('a segment with half its own cells already cleared externally seeds a shorter work timer than the same segment fully solid', () => {
    // A length-8/depth-8 ramp's segment index 2 (one of its widest layers —
    // #925 segments are now per-depth-layer, not per-column) carves ~24
    // cells — well clear of the floor(1-tick) case a shallow single-layer
    // segment would hit, so halving its live voxel count actually moves the
    // tick count (confirmed against real seed:42/size:32 terrain: segment
    // cell counts run 0, 22, 24, 21, 18, 15, 12, 9, 6, 3, 3 across its 11
    // layers, topmost to deepest).
    const RAMP_ARGS = 'origin:16,19 direction:south length:8 depth:8';
    const SEGMENT_INDEX = 2;

    // Scenario A — baseline: every one of the segment's cells is still solid
    // when the digger arrives.
    const a = createRunner();
    expect(runCommand(a, 'new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(runCommand(a, `build_ramp ${RAMP_ARGS}`).success).toBe(true);
    const rampA = a.ctx.state!.plannedRamps[0]!;
    const segmentA = rampA.segments[SEGMENT_INDEX]!;
    expect(segmentA.cells.length).toBeGreaterThan(10);

    // Scenario B — identical order (same stale order-time cells.length), but
    // half of the segment's own cells are cleared directly in the live grid
    // right after ordering, before any tick runs.
    const b = createRunner();
    expect(runCommand(b, 'new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(runCommand(b, `build_ramp ${RAMP_ARGS}`).success).toBe(true);
    const rampB = b.ctx.state!.plannedRamps[0]!;
    const segmentB = rampB.segments[SEGMENT_INDEX]!;
    // Same seed, same order -> identical order-time footprint.
    expect(segmentB.cells).toEqual(segmentA.cells);

    const half = Math.ceil(segmentB.cells.length / 2);
    for (const cell of segmentB.cells.slice(0, half)) {
      b.ctx.grid!.clearVoxel(cell.x, cell.y, cell.z);
    }
    const liveVoxelCountB = segmentB.cells.filter(c => b.ctx.grid!.densityAt(c.x, c.y, c.z) > 0).length;
    expect(liveVoxelCountB).toBeLessThan(segmentB.cells.length);

    // Drive each simulation tick-by-tick, pinning every employee's needs at
    // full each tick (mirrors the #923 box-cut test's own pattern above) so
    // getNeedMultiplier can never confound the voxel-count comparison, until
    // the digger's work timer is seeded — employee.taskTicksRemaining flips
    // from null to a number the instant tickArrivalGate calls
    // seedTaskTimerFields on arrival, and that seeded value IS
    // computeActionWorkTicks's return, read before any tick spends it down.
    // Only one rock_digger vehicle exists in the staffed roster, so it may
    // work other (shallower) segments first before reaching SEGMENT_INDEX —
    // budget generously for that.
    function captureSeededWorkTicks(engine: ReturnType<typeof createRunner>, actionId: number): number {
      for (let i = 0; i < 800; i++) {
        for (const emp of engine.ctx.state!.employees.employees) {
          emp.fatigue = 100;
        }
        const action = engine.ctx.state!.pendingActions.find(act => act.id === actionId);
        const holder = action && action.holderId !== null
          ? engine.ctx.state!.employees.employees.find(e => e.id === action.holderId)
          : undefined;
        if (holder && holder.taskTicksRemaining !== null) return holder.taskTicksRemaining;
        expect(runCommand(engine, 'tick 1').success).toBe(true);
      }
      throw new Error('digger never started working on the ramp segment within 800 ticks');
    }

    const workTicksA = captureSeededWorkTicks(a, segmentA.actionId);
    const workTicksB = captureSeededWorkTicks(b, segmentB.actionId);

    // Must fail against the #924 stub: it ignores `grid` for dig_ramp_segment
    // entirely, so clearing half of segment B's cells externally has no
    // effect and both seed the identical (stale cells.length-based) duration.
    expect(workTicksB).toBeLessThan(workTicksA);

    // Roughly proportional to the live voxel count actually dug, not the
    // stale order-time cells.length (which is identical for A and B) — kept
    // loose (not pinned to an exact formula) since travel time is not part
    // of this measurement but the exact tier/proficiency/need/lq wiring is
    // an implementation detail of #924, not of this integration test.
    const expectedRatio = liveVoxelCountB / segmentA.cells.length;
    const actualRatio = workTicksB / workTicksA;
    expect(actualRatio).toBeGreaterThan(expectedRatio - 0.15);
    expect(actualRatio).toBeLessThan(expectedRatio + 0.15);
    expectNoWorldInvariantViolations(a.ctx.state!);
    expectNoWorldInvariantViolations(b.ctx.state!);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #1085 — the #1000/#1002 starvation override must apply identically to a
// TIMER-DRIVEN vehicle-gated completion (dig_ramp_segment, resolved in
// src/console/commands/tickTaskCompletion.ts) as it already does to a
// PHASE-DRIVEN one (haul_debris/fragment_debris, resolved through
// completeVehicleGatedActionIfApplicable via ArrivalGate's completion pass
// in tick.ts — see buildings.integration.test.ts's own #1000 describe block,
// the haul_debris mirror of this exact scenario). Today
// tickTaskCompletion.ts hand-rolls tryContinueVehicleGatedAction +
// releaseVehicleOnCompletion for a timer-driven completion instead of
// calling the shared completeVehicleGatedActionIfApplicable, so
// findStarvedActionForEmployee never runs on that path — a deep
// dig_ramp_segment chain can starve out an unclaimed place_building order
// forever, the same bug #1000 fixed for haul_debris but left open here.
// ═══════════════════════════════════════════════════════════════════════════

describe('dig_ramp_segment — starvation override on the timer-driven completion path (#1085)', () => {
  function tickWithFatigueToppedUp(ctx: GameContext): void {
    // Mirrors buildings.integration.test.ts's own #1000 helper: pins every
    // employee's fatigue at full each tick so an unrelated forced-rest
    // interruption can never hand the digger a spontaneous idle window of
    // its own, which would let ordinary (non-continuity) idle dispatch pick
    // up the place_building order for a reason that has nothing to do with
    // this bug.
    for (const emp of ctx.state!.employees.employees) emp.fatigue = 100;
    tickCommand(ctx, ['1'], {});
  }

  it('a starved place_building order wins dispatch over dig_ramp_segment vehicle continuity — same reservation/release shape the phase-driven (haul_debris) path already produces', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: 42, size: 32, cash: 1_000_000 });

    // Roster: exactly ONE rock_digger-licensed driver, and nobody else —
    // reproduces the bug precisely: without the #1085 fix, this driver can
    // never be spared for the place_building order once the ramp's segment
    // chain exists, because tickTaskCompletion.ts's dig_ramp_segment
    // completion branch never checks findStarvedActionForEmployee at all.
    const hireResult = employeeCommand(ctx, ['hire'], { role: 'driver' });
    expect(hireResult.success, JSON.stringify(hireResult)).toBe(true);
    const digger = ctx.state!.employees.employees[ctx.state!.employees.employees.length - 1]!;
    assignSkill(ctx.state!.employees, digger.id, 'driving.excavator', 1);

    const buyResult = vehicleCommand(ctx, ['buy', 'rock_digger'], {});
    expect(buyResult.success, JSON.stringify(buyResult)).toBe(true);
    const vehicle = ctx.state!.vehicles.vehicles[0]!;

    // Same ramp footprint #924's own suite already proved out against this
    // exact seed/size/origin (11 segments, several with well over 10 cells
    // each) — plenty of segment-to-segment continuity hops for the ramp to
    // still be mid-chain by the time the override should fire.
    const rampResult = buildRampCommand(ctx, [], { origin: '16,19', direction: 'south', length: '8', depth: '8' });
    expect(rampResult.success, JSON.stringify(rampResult)).toBe(true);
    expect(ctx.state!.plannedRamps).toHaveLength(1);
    const rampId = ctx.state!.plannedRamps[0]!.id;
    expect(ctx.state!.plannedRamps[0]!.segments.length).toBeGreaterThan(2);

    // Let the digger actually commit to the ramp chain first through
    // ordinary idle dispatch — not the continuity fast path — mirroring
    // #1000's own "let every driver commit to the backlog first" setup, so
    // the place_building order below is queued only once vehicle continuity
    // is the ONLY thing standing between the digger and it.
    const isDigging = (): boolean => {
      const action = digger.activeActionId !== null
        ? ctx.state!.pendingActions.find(a => a.id === digger.activeActionId)
        : undefined;
      return action?.type === 'dig_ramp_segment';
    };
    for (let i = 0; i < 100 && !isDigging(); i++) tickWithFatigueToppedUp(ctx);
    expect(isDigging(), JSON.stringify(digger)).toBe(true);

    const buildingResult = buildCommand(ctx, ['freight_warehouse'], { at: '6,9' });
    expect(buildingResult.success, JSON.stringify(buildingResult)).toBe(true);
    const placeBuildingActionId = ctx.state!.pendingActions.find(a => a.type === 'place_building')!.id;

    // Backdate the order's own queuedAtTick so it counts as already having
    // waited ACTION_STARVATION_TICK_THRESHOLD ticks — only the *elapsed-tick
    // delta* findStarvedActionForEmployee reads matters, not real wall-clock
    // ticks spent waiting for it (same technique VehicleContinuity.test.ts's
    // own #1085 fixture uses at the unit level). This keeps the ramp
    // genuinely mid-chain, rather than gambling on whether hundreds of real
    // ticks would let a single digger fully drain an 11-segment ramp before
    // or after crossing the threshold.
    const placeAction = ctx.state!.pendingActions.find(a => a.id === placeBuildingActionId)!;
    placeAction.queuedAtTick = ctx.state!.tickCount - ACTION_STARVATION_TICK_THRESHOLD;

    let assignedAtTick: number | null = null;
    let rampStillOpenWhenAssigned = false;
    const TICK_BUDGET = 500; // generous margin over a single ramp segment's own work duration

    for (let i = 0; i < TICK_BUDGET; i++) {
      tickWithFatigueToppedUp(ctx);
      const action = ctx.state!.pendingActions.find(a => a.id === placeBuildingActionId);
      if (action && action.status === 'assigned') {
        assignedAtTick = ctx.state!.tickCount;
        rampStillOpenWhenAssigned = ctx.state!.plannedRamps.some(r => r.id === rampId);
        break;
      }
    }

    // Regression assertion (fails today): once the threshold is crossed, the
    // starved place_building order must be handed to the digger instead of
    // the driver perpetually continuing to the next ramp segment via
    // tryContinueVehicleGatedAction's own continuity fast path.
    expect(
      assignedAtTick,
      'place_building order was never assigned — the starvation override never fired for the timer-driven (dig_ramp_segment) completion path',
    ).not.toBeNull();
    // Proves the override actually preempted an in-progress ramp — not that
    // the ramp coincidentally finished first and the digger picked up the
    // building afterward through ordinary idle dispatch.
    expect(rampStillOpenWhenAssigned).toBe(true);
    expect(ctx.state!.plannedRamps.some(r => r.id === rampId)).toBe(true); // ramp interrupted, not finished

    const landedAction = ctx.state!.pendingActions.find(a => a.id === placeBuildingActionId)!;
    expect(landedAction.status).toBe('assigned');
    expect(landedAction.holderId).toBe(digger.id);
    expect(digger.activeActionId).toBe(placeBuildingActionId);

    // Same reservation/release shape the phase-driven (#1000/#1002) path
    // already produces for the same starvation event: the vehicle is fully
    // released, not left reserved-but-idle on the abandoned ramp segment.
    expect(vehicle.driverId).toBeNull();
    expect(vehicle.reservedForActionId).toBeNull();

    expectNoWorldInvariantViolations(ctx.state!);
  });
});
