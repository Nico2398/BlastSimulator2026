// BlastSimulator2026 — Integration tests: Vehicle fleet (Phase 5)
// Covers purchase, listing, driver assignment, movement, task assignment, and tick.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { vehicleCommand } from '../../src/console/commands/vehicle.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { tickCommand } from '../../src/console/commands/events.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import {
  createVehicleState,
  purchaseVehicle,
  assignDriver,
  destroyVehicle,
  getVehicleDef,
  getVehicleDefByTier,
  getAllVehicleRoles,
} from '../../src/core/entities/Vehicle.js';
import {
  createEmployeeState,
  hireEmployee,
  assignSkill,
} from '../../src/core/entities/Employee.js';
import { tickVehicle } from '../../src/core/engine/GameLoop.js';
import { Random } from '../../src/core/math/Random.js';
import { TRAFFIC_JAM_MIN_VEHICLES, TRAFFIC_JAM_MIN_TICKS } from '../../src/core/config/balance.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build a fresh context with a real GameState (seed=42, desert biome). */
function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
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

  it('assign driver with driving skill succeeds', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    const eid = hireOne(ctx, 'driver');
    employeeCommand(ctx, ['assign_skill', String(eid)], { skill: 'driving.truck', level: '1' });

    const result = vehicleCommand(ctx, ['driver', '1', String(eid)], {});

    expect(result.success).toBe(true);
    expect(result.output).toBe(`Driver #${eid} assigned to vehicle #1.`);
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
  });

  // ── Movement ──

  it('move vehicle to target coordinates', () => {
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    // Vehicle spawns at sizeX/2, sizeZ/2 → (16, 16) for a 32x32 world
    const v = ctx.state!.vehicles.vehicles[0]!;
    expect(v.targetX).toBe(16);
    expect(v.targetZ).toBe(16);

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
    // Spawned at (16, 16). Set target farther away.
    v.targetX = 20;
    v.targetZ = 16;
    v.task = 'moving';
    v.state = 'idle';

    const origX = v.x;
    // makeCtx() runs new_game, which builds a NavGrid — tickVehicle routes via
    // Pathfinding.findPath and advances at debris_hauler's own speed (3
    // cells/tick, see VEHICLE_BASE_STATS) rather than a flat 1 cell/tick (#407).
    const debrisHaulerSpeed = 3;

    tickVehicle(ctx.state!, v);

    // Should have moved debrisHaulerSpeed cells closer to target (20, 16)
    if (v.task === 'moving') {
      expect(v.x).toBe(origX + debrisHaulerSpeed);
    }
    // If the vehicle arrived, task becomes 'idle' and x == targetX
    if (v.task === 'idle') {
      expect(v.x).toBe(20);
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
    const emptyCtx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
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
});
