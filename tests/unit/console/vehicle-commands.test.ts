// BlastSimulator2026 — vehicle command unit tests
// Tests for the `driver` sub-command and driver-aware `list` output.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import { vehicleCommand } from '../../../src/console/commands/entities.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { createTubingState } from '../../../src/core/mining/Tubing.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { createEmployeeState, type Employee } from '../../../src/core/entities/Employee.js';

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

/**
 * Add a debris_hauler vehicle to the context fleet and return its ID.
 * Uses purchaseVehicle so the vehicle is wired up exactly as the game does it.
 */
function addTruckVehicle(ctx: MiningContext): number {
  const { vehicle } = purchaseVehicle(ctx.state!.vehicles, 'debris_hauler', 0, 0);
  return vehicle.id;
}

/**
 * Add a drill_rig vehicle to the context fleet and return its ID.
 */
function addDrillRig(ctx: MiningContext): number {
  const { vehicle } = purchaseVehicle(ctx.state!.vehicles, 'drill_rig', 0, 0);
  return vehicle.id;
}

/**
 * Push a qualified truck driver (driving.truck licence) directly into employee state.
 * Returns the new employee's ID.
 */
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

/**
 * Push a qualified drill rig driver (driving.drill_rig licence) directly into employee state.
 * Returns the new employee's ID.
 */
function addDrillRigDriver(ctx: MiningContext): number {
  const emp: Employee = {
    id: ctx.state!.employees.nextId++,
    name: 'Test Drill Driver',
    role: 'driver',
    salary: 1000,
    morale: 60,
    unionized: false,
    injured: false,
    alive: true,
    x: 0,
    z: 0,
    qualifications: [{ category: 'driving.drill_rig', proficiencyLevel: 1, xp: 0 }],
    trainingState: null,
  };
  ctx.state!.employees.employees.push(emp);
  return emp.id;
}

/**
 * Push an employee with NO driving qualifications into employee state.
 * Returns the new employee's ID.
 */
function addUnqualifiedEmployee(ctx: MiningContext): number {
  const emp: Employee = {
    id: ctx.state!.employees.nextId++,
    name: 'Office Worker',
    role: 'manager',
    salary: 2000,
    morale: 80,
    unionized: false,
    injured: false,
    alive: true,
    x: 0,
    z: 0,
    qualifications: [],
    trainingState: null,
  };
  ctx.state!.employees.employees.push(emp);
  return emp.id;
}

// ── vehicle driver — happy path ──

describe('vehicle driver — successful assignment', () => {
  it('returns success when a qualified driver is assigned to a matching vehicle', () => {
    const ctx = makeCtx();
    const vehicleId = addTruckVehicle(ctx);
    const employeeId = addTruckDriver(ctx);

    const result = vehicleCommand(ctx, ['driver', String(vehicleId), String(employeeId)], {});

    expect(result.success).toBe(true);
  });

  it('success message contains the vehicle ID', () => {
    const ctx = makeCtx();
    const vehicleId = addTruckVehicle(ctx);
    const employeeId = addTruckDriver(ctx);

    const result = vehicleCommand(ctx, ['driver', String(vehicleId), String(employeeId)], {});

    expect(result.output).toContain(String(vehicleId));
  });

  it('success message contains the employee ID', () => {
    const ctx = makeCtx();
    const vehicleId = addTruckVehicle(ctx);
    const employeeId = addTruckDriver(ctx);

    const result = vehicleCommand(ctx, ['driver', String(vehicleId), String(employeeId)], {});

    expect(result.output).toContain(String(employeeId));
  });

  it('sets driverId on the vehicle after assignment', () => {
    const ctx = makeCtx();
    const vehicleId = addTruckVehicle(ctx);
    const employeeId = addTruckDriver(ctx);

    vehicleCommand(ctx, ['driver', String(vehicleId), String(employeeId)], {});

    const vehicle = ctx.state!.vehicles.vehicles.find(v => v.id === vehicleId);
    expect(vehicle!.driverId).toBe(employeeId);
  });

  it('assigns a drill_rig driver with the driving.drill_rig licence', () => {
    const ctx = makeCtx();
    const vehicleId = addDrillRig(ctx);
    const employeeId = addDrillRigDriver(ctx);

    const result = vehicleCommand(ctx, ['driver', String(vehicleId), String(employeeId)], {});

    expect(result.success).toBe(true);
    const vehicle = ctx.state!.vehicles.vehicles.find(v => v.id === vehicleId);
    expect(vehicle!.driverId).toBe(employeeId);
  });
});

// ── vehicle driver — invalid argument guards ──

describe('vehicle driver — invalid argument guards', () => {
  it('returns usage error when vehicleId is not a number', () => {
    const ctx = makeCtx();
    const employeeId = addTruckDriver(ctx);

    const result = vehicleCommand(ctx, ['driver', 'abc', String(employeeId)], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe('Usage: vehicle driver <vehicleId> <employeeId>');
  });

  it('returns usage error when employeeId is not a number', () => {
    const ctx = makeCtx();
    const vehicleId = addTruckVehicle(ctx);

    const result = vehicleCommand(ctx, ['driver', String(vehicleId), 'xyz'], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe('Usage: vehicle driver <vehicleId> <employeeId>');
  });

  it('returns usage error when both arguments are omitted', () => {
    const ctx = makeCtx();

    const result = vehicleCommand(ctx, ['driver'], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe('Usage: vehicle driver <vehicleId> <employeeId>');
  });
});

// ── vehicle driver — domain validation errors ──

describe('vehicle driver — domain validation errors', () => {
  it('returns vehicle not found error for a non-existent vehicle ID', () => {
    const ctx = makeCtx();
    const employeeId = addTruckDriver(ctx);
    const nonExistentVehicleId = 9999;

    const result = vehicleCommand(
      ctx,
      ['driver', String(nonExistentVehicleId), String(employeeId)],
      {},
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(`Vehicle #${nonExistentVehicleId} not found.`);
  });

  it('returns licence error when employee lacks the required driving qualification', () => {
    const ctx = makeCtx();
    const vehicleId = addTruckVehicle(ctx);
    const employeeId = addUnqualifiedEmployee(ctx);

    const result = vehicleCommand(ctx, ['driver', String(vehicleId), String(employeeId)], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe('Employee lacks licence for this role');
  });

  it('returns licence error when employee has a licence for wrong vehicle type', () => {
    const ctx = makeCtx();
    // drill_rig requires driving.drill_rig, but we assign a truck driver
    const vehicleId = addDrillRig(ctx);
    const employeeId = addTruckDriver(ctx); // has driving.truck, not driving.drill_rig

    const result = vehicleCommand(ctx, ['driver', String(vehicleId), String(employeeId)], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe('Employee lacks licence for this role');
  });

  it('returns "vehicle already has a driver" when vehicle is already assigned', () => {
    const ctx = makeCtx();
    const vehicleId = addTruckVehicle(ctx);
    const firstDriverId = addTruckDriver(ctx);
    const secondDriverId = addTruckDriver(ctx);

    // Assign first driver successfully
    vehicleCommand(ctx, ['driver', String(vehicleId), String(firstDriverId)], {});

    // Attempt to assign a second driver to the same vehicle
    const result = vehicleCommand(
      ctx,
      ['driver', String(vehicleId), String(secondDriverId)],
      {},
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe('Vehicle already has a driver');
  });

  it('returns "employee already driving another vehicle" when driver is occupied', () => {
    const ctx = makeCtx();
    const firstVehicleId = addTruckVehicle(ctx);
    const secondVehicleId = addTruckVehicle(ctx);
    const employeeId = addTruckDriver(ctx);

    // Assign driver to first vehicle successfully
    vehicleCommand(ctx, ['driver', String(firstVehicleId), String(employeeId)], {});

    // Attempt to assign same driver to second vehicle
    const result = vehicleCommand(
      ctx,
      ['driver', String(secondVehicleId), String(employeeId)],
      {},
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe('Employee already driving another vehicle');
  });
});

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
