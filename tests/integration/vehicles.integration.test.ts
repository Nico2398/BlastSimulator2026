// BlastSimulator2026 — Integration tests: Vehicle fleet (Phase 5)
// Covers purchase, listing, driver assignment, movement, task assignment, and tick.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { vehicleCommand } from '../../src/console/commands/vehicle.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import {
  createVehicleState,
  purchaseVehicle,
  assignDriver,
  destroyVehicle,
  getVehicleDef,
  getAllVehicleRoles,
} from '../../src/core/entities/Vehicle.js';
import {
  createEmployeeState,
  hireEmployee,
  assignSkill,
} from '../../src/core/entities/Employee.js';
import { tickVehicle } from '../../src/core/engine/GameLoop.js';
import { Random } from '../../src/core/math/Random.js';

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

    tickVehicle(ctx.state!, v);

    // Should have moved one cell closer to target (20, 16)
    if (v.task === 'moving') {
      expect(v.x).toBe(origX + 1);
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
});
