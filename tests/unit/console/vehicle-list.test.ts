// BlastSimulator2026 — vehicle list command unit tests
// Tests for driver-info display in `vehicle list` output.

import { describe, it, expect } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import { vehicleCommand } from '../../../src/console/commands/vehicle.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { createTubingState } from '../../../src/core/mining/Tubing.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../src/core/entities/Employee.js';

// ── Test context factory ──

function makeCtx(): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    softwareTier: 0,
    tubingState: createTubingState(),
    emitter: new EventEmitter(),
  };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32' });
  return ctx;
}

function addTruckVehicle(ctx: MiningContext): number {
  const { vehicle } = purchaseVehicle(ctx.state!.vehicles, 'debris_hauler', 0, 0);
  return vehicle.id;
}

function addTruckDriver(ctx: MiningContext): number {
  const emp: Employee = {
    id: ctx.state!.employees.nextId++,
    name: 'Test Truck Driver',
    role: 'driver',
    salary: 1000,
    morale: 60,
    unionized: false,
    injured: false,
    alive: true,
    x: 0,
    z: 0,
    qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0 }],
    trainingState: null,
  };
  ctx.state!.employees.employees.push(emp);
  return emp.id;
}

// ── vehicle list — driver display ──

describe('vehicle list — driver display', () => {
  it('shows driver:none when a vehicle has no assigned driver', () => {
    const ctx = makeCtx();
    addTruckVehicle(ctx);

    const result = vehicleCommand(ctx, ['list'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('driver:none');
  });

  it('shows driver:#<id> when a vehicle has an assigned driver', () => {
    const ctx = makeCtx();
    const vehicleId = addTruckVehicle(ctx);
    const employeeId = addTruckDriver(ctx);
    vehicleCommand(ctx, ['driver', String(vehicleId), String(employeeId)], {});

    const result = vehicleCommand(ctx, ['list'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain(`driver:#${employeeId}`);
  });

  it('shows driver:none for an undriven vehicle alongside a driven one', () => {
    const ctx = makeCtx();
    const drivenVehicleId = addTruckVehicle(ctx);
    const undrivenVehicleId = addTruckVehicle(ctx);
    const employeeId = addTruckDriver(ctx);
    vehicleCommand(ctx, ['driver', String(drivenVehicleId), String(employeeId)], {});

    const result = vehicleCommand(ctx, ['list'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain(`[${drivenVehicleId}]`);
    expect(result.output).toContain(`[${undrivenVehicleId}]`);
    expect(result.output).toContain(`driver:#${employeeId}`);
    expect(result.output).toContain('driver:none');
  });

  it('list output includes the driver ID in the line for that specific vehicle', () => {
    const ctx = makeCtx();
    const vehicleId = addTruckVehicle(ctx);
    const employeeId = addTruckDriver(ctx);
    vehicleCommand(ctx, ['driver', String(vehicleId), String(employeeId)], {});

    const result = vehicleCommand(ctx, ['list'], {});

    const lines = result.output!.split('\n');
    const vehicleLine = lines.find(l => l.includes(`[${vehicleId}]`));
    expect(vehicleLine).toBeDefined();
    expect(vehicleLine).toContain(`driver:#${employeeId}`);
  });
});
