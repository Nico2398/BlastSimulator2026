// BlastSimulator2026 — Integration tests: Vehicle fleet (Phase 5)
// Covers purchase, listing, driver assignment, movement, task assignment, and tick.

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { vehicleCommand } from '../../src/console/commands/vehicle.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { tickCommand } from '../../src/console/commands/events.js';
import { makeGameContext, makeEmptyGameContext } from '../helpers/gameContext.js';
import {
  createVehicleState,
  purchaseVehicle,
  assignDriver,
  destroyVehicle,
  getVehicleDef,
  getVehicleDefByTier,
  getAllVehicleRoles,
} from '../../src/core/entities/Vehicle.js';
import type { VehicleTask } from '../../src/core/entities/Vehicle.js';
import {
  createEmployeeState,
  hireEmployee,
  assignSkill,
  killEmployee,
} from '../../src/core/entities/Employee.js';
import { tickVehicle } from '../../src/core/engine/GameLoop.js';
import { Random } from '../../src/core/math/Random.js';
import {
  TRAFFIC_JAM_MIN_VEHICLES,
  TRAFFIC_JAM_MIN_TICKS,
  VEHICLE_OCCUPANCY_REROUTE_THRESHOLD,
} from '../../src/core/config/balance.js';
import { createRunner, runCommand } from '../../src/console/createRunner.js';

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
  });

  it('buy vehicle reduces cash', () => {
    const cashBefore = ctx.state!.cash;
    const def = getVehicleDef('debris_hauler');

    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});

    expect(ctx.state!.cash).toBe(cashBefore - def.purchaseCost);
  });

  it('rejects unknown vehicle type', () => {
    const result = vehicleCommand(ctx, ['buy', 'spaceship'], {});

    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage: vehicle buy');
    expect(ctx.state!.vehicles.vehicles).toHaveLength(0);
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

    const result = vehicleCommand(ctx, ['move', '1'], { to: '30,30' });

    expect(result.success).toBe(true);
    expect(v.task).toBe('moving');
    expect(v.targetX).toBe(30);
    expect(v.targetZ).toBe(30);
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
  });

  // ── tickVehicle advances movement ──

  it('tickVehicle advances movement toward target', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    const v = ctx.state!.vehicles.vehicles[0]!;
    const origX = v.x;
    // Target set relative to the vehicle's actual spawn cell, same row, pure
    // +X — not a hardcoded (16,16)/(20,16) pair (#458 T9.1/D15). The new
    // terrain generator's spawn placement no longer lands exactly on (16,16),
    // and a hardcoded target off by even one z put the path on a real
    // diagonal detour instead of the straight line this test means to check.
    v.targetX = origX + 4;
    v.targetZ = v.z;
    v.task = 'moving';
    v.state = 'idle';

    // makeCtx() runs new_game, which builds a NavGrid — tickVehicle routes via
    // Pathfinding.findPath and advances at debris_hauler's own speed (3
    // cells/tick, see VEHICLE_BASE_STATS) rather than a flat 1 cell/tick (#407).
    const debrisHaulerSpeed = 3;

    tickVehicle(ctx.state!, v);

    // Should have moved debrisHaulerSpeed cells closer to target
    const taskAfterTick = v.task as VehicleTask;
    if (taskAfterTick === 'moving') {
      expect(v.x).toBe(origX + debrisHaulerSpeed);
    }
    // If the vehicle arrived, task becomes 'idle' and x == targetX
    if (taskAfterTick === 'idle') {
      expect(v.x).toBe(origX + 4);
    }
  });

  it('tickVehicle does nothing for idle vehicle', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    const v = ctx.state!.vehicles.vehicles[0]!;
    v.task = 'idle';
    v.state = 'idle';
    const origX = v.x;
    const origZ = v.z;

    tickVehicle(ctx.state!, v);

    expect(v.x).toBe(origX);
    expect(v.z).toBe(origZ);
    expect(v.task).toBe('idle');
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
  });

  // ── Core API: purchaseVehicle / assignDriver / destroyVehicle ──

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

  it('assignDriver core API rejects unlicensed employee', () => {
    const vs = createVehicleState();
    purchaseVehicle(vs, 'debris_hauler', 0, 0);
    const es = createEmployeeState();
    const rng = new Random(42);
    const { employee } = hireEmployee(es, 'blaster', rng);
    // blaster has no driving.truck qualification

    const result = assignDriver(vs, es, 1, employee.id);

    expect(result.success).toBe(false);
    expect(result.error).toContain('lacks licence');
  });

  it('assignDriver core API succeeds with qualified employee', () => {
    const vs = createVehicleState();
    purchaseVehicle(vs, 'debris_hauler', 0, 0);
    const es = createEmployeeState();
    const rng = new Random(42);
    const { employee } = hireEmployee(es, 'driver', rng);
    assignSkill(es, employee.id, 'driving.truck', 1);

    const result = assignDriver(vs, es, 1, employee.id);

    expect(result.success).toBe(true);
    expect(vs.vehicles[0]!.driverId).toBe(employee.id);
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
  });

  // ── vehicle buy — tier arg (#411) ──

  describe('vehicle buy — tier arg (#411)', () => {
    it('buy with tier:2 purchases a tier-2 vehicle', () => {
      const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '2' });

      expect(result.success).toBe(true);
      const v = ctx.state!.vehicles.vehicles[0]!;
      expect(v.tier).toBe(2);
    });

    it('buy with tier:2 deducts the tier-2 cost (not tier-1) from cash', () => {
      const cashBefore = ctx.state!.cash;
      const tier2Def = getVehicleDefByTier('debris_hauler', 2);

      vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '2' });

      expect(ctx.state!.cash).toBe(cashBefore - tier2Def.purchaseCost);
    });

    it('buy with tier:3 purchases a tier-3 vehicle at tier-3 cost', () => {
      const cashBefore = ctx.state!.cash;
      const tier3Def = getVehicleDefByTier('drill_rig', 3);

      const result = vehicleCommand(ctx, ['buy', 'drill_rig'], { tier: '3' });

      expect(result.success).toBe(true);
      const v = ctx.state!.vehicles.vehicles[0]!;
      expect(v.tier).toBe(3);
      expect(ctx.state!.cash).toBe(cashBefore - tier3Def.purchaseCost);
    });

    it('buy without a tier arg still defaults to tier 1 (backward compatible)', () => {
      vehicleCommand(ctx, ['buy', 'debris_hauler'], {});

      const v = ctx.state!.vehicles.vehicles[0]!;
      expect(v.tier).toBe(1);
    });

    it('rejects tier:0 as out of range and does not add a vehicle', () => {
      const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '0' });

      expect(result.success).toBe(false);
      expect(ctx.state!.vehicles.vehicles).toHaveLength(0);
    });

    it('rejects tier:9 as out of range and does not add a vehicle', () => {
      const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '9' });

      expect(result.success).toBe(false);
      expect(ctx.state!.vehicles.vehicles).toHaveLength(0);
    });

    it('rejects non-numeric tier:abc and does not add a vehicle', () => {
      const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: 'abc' });

      expect(result.success).toBe(false);
      expect(ctx.state!.vehicles.vehicles).toHaveLength(0);
    });

    it('does not deduct cash when the tier is rejected', () => {
      const cashBefore = ctx.state!.cash;

      vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '9' });

      expect(ctx.state!.cash).toBe(cashBefore);
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
      }

      const result = tickCommand(ctx, ['1'], {});

      expect(result.success).toBe(true);
      expect(ctx.state!.events.pendingEvent).not.toBeNull();
      expect(ctx.state!.events.pendingEvent?.eventId).toBe('traffic_jam');
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
    });

    it('a same-role follow-up action keeps the driller mounted in the same vehicle instead of dismounting and re-walking', () => {
      const eid = hireLicensedDriller();
      // Master-level 'blasting' (proficiency 5, ×0.40 duration multiplier) —
      // this test is about mount continuity across a claim, not about task
      // duration, so it keeps both dispatches' combined drive+work time well
      // under the ~47-tick fatigue-collapse ceiling (NEED_DRAIN_RATES.fatigue.working
      // × NEED_COLLAPSE_THRESHOLDS.fatigue, balance.ts). At Rookie level 1 the
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
      vehicle.reservedForActionId = actionId;
      emp.taskTicksRemaining = null;

      killEmployee(ctx.state!.employees, eid);
      tickCommand(ctx, ['1'], {});

      expect(vehicle.reservedForActionId).toBeNull();
      expect(vehicle.driverId).toBeNull();
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
    });
  });

  // ── #921: player-facing driver assignment removed — the fully automatic
  // claim/board/release path already exists in core (VehicleReservation.ts,
  // VehicleBoarding.ts, ArrivalGate.resolveBoarding) and needs no changes for
  // this issue. These two tests pin that no manual affordance
  // (`vehicleCommand(['driver', ...])` / `assignDriver`) is ever needed for a
  // queued vehicle-gated task to claim, board, and complete on its own.
  describe('fully automatic driver claim — no player affordance used (#921)', () => {
    it('a bought vehicle + a licensed, idle employee + a queued vehicle-gated action: driverId is set to that employee and the action progresses with zero manual "vehicle driver"/assignDriver calls', () => {
      const eid = hireOne(ctx, 'driller');
      employeeCommand(ctx, ['assign_skill', String(eid)], { skill: 'driving.drill_rig', level: '1' });
      vehicleCommand(ctx, ['buy', 'drill_rig'], {});
      const vehicle = ctx.state!.vehicles.vehicles[0]!;

      // Nothing below this line ever calls vehicleCommand(['driver', ...]) or
      // the core assignDriver() function — the claim has to happen on its own.
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
  });
});
