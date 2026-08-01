// BlastSimulator2026 — vehicle command unit tests
// Tests for the `driver` sub-command and driver-aware `list` output.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import { vehicleCommand } from '../../../src/console/commands/vehicle.js';
import { tickCommand } from '../../../src/console/commands/events.js';
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
 * Fields every Employee needs beyond the identity/role/qualification basics —
 * factored out so the three fixture builders below stay in sync with the
 * Employee interface (issue #437 added several "pending" and "destination"
 * fields; a fixture missing them isn't a type error in test files — tests
 * aren't typechecked — but tickCommand's movement/arrival-gate pipeline reads
 * them directly and crashes on `undefined` rather than failing a clean
 * assertion).
 */
function employeeMovementDefaults(): Omit<
  Employee,
  'id' | 'name' | 'role' | 'salary' | 'morale' | 'unionized' | 'injured' | 'alive' | 'x' | 'z' | 'qualifications' | 'trainingState'
> {
  return {
    activeActionId: null,
    hunger: 100,
    fatigue: 100,
    breakNeed: 100,
    collapsing: false,
    interruptedActionPayload: null,
    ticksWorked: 0,
    restTicksRemaining: null,
    taskTicksRemaining: null,
    activeTaskSkill: null,
    restNeedKey: null,
    destinationX: null,
    destinationZ: null,
    moveConsecutiveFailures: 0,
    isMoveStuck: false,
    pendingRestDuration: null,
    pendingRestNeedKey: null,
    pendingTaskDuration: null,
    pendingActionType: null,
    pendingActionPayload: null,
    pendingDriverVehicleId: null,
    pendingTrainingStart: null,
  };
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
    ...employeeMovementDefaults(),
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
    ...employeeMovementDefaults(),
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
    ...employeeMovementDefaults(),
  };
  ctx.state!.employees.employees.push(emp);
  return emp.id;
}

// ── vehicle driver — happy path ──

describe('vehicle driver — successful assignment', () => {
  // Issue #437: "vehicle driver" now only *requests* boarding — the licence
  // and availability checks still happen eagerly (so the command still
  // reports success/failure immediately), but the actual driverId assignment
  // is deferred to ArrivalGate.tickArrivalGate, once the employee has walked
  // to the vehicle. Every fixture employee here spawns at the same (0,0) as
  // the fixture vehicle, so a single tick is enough to resolve arrival.

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

  it('does NOT set driverId synchronously — driverId stays null until a tick resolves arrival', () => {
    const ctx = makeCtx();
    const vehicleId = addTruckVehicle(ctx);
    const employeeId = addTruckDriver(ctx);

    const result = vehicleCommand(ctx, ['driver', String(vehicleId), String(employeeId)], {});
    expect(result.success).toBe(true);

    const vehicle = ctx.state!.vehicles.vehicles.find(v => v.id === vehicleId);
    expect(vehicle!.driverId).toBeNull();

    tickCommand(ctx, ['1'], {});
    expect(vehicle!.driverId).toBe(employeeId);
  });

  it('assigns a drill_rig driver with the driving.drill_rig licence, once a tick resolves arrival', () => {
    const ctx = makeCtx();
    const vehicleId = addDrillRig(ctx);
    const employeeId = addDrillRigDriver(ctx);

    const result = vehicleCommand(ctx, ['driver', String(vehicleId), String(employeeId)], {});

    expect(result.success).toBe(true);
    const vehicle = ctx.state!.vehicles.vehicles.find(v => v.id === vehicleId);
    expect(vehicle!.driverId).toBeNull();

    tickCommand(ctx, ['1'], {});
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

    // Assign first driver successfully — resolve the walk so driverId is
    // actually set before the second request is evaluated (#437).
    vehicleCommand(ctx, ['driver', String(vehicleId), String(firstDriverId)], {});
    // Issue #437: driverId is only set once the arrival gate resolves — the
    // first driver must actually board before the second request can see the
    // vehicle as taken.
    tickCommand(ctx, ['1'], {});

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

    // Assign driver to first vehicle successfully — resolve the walk so
    // driverId is actually set before the second request is evaluated (#437).
    vehicleCommand(ctx, ['driver', String(firstVehicleId), String(employeeId)], {});
    // Issue #437: driverId is only set once the arrival gate resolves.
    tickCommand(ctx, ['1'], {});

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

