// BlastSimulator2026 — vehicle list command unit tests
// Tests for driver-info display in `vehicle list` output.

import { describe, it, expect } from 'vitest';
import { vehicleCommand } from '../../../src/console/commands/vehicle.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { tickEmployeeMovement } from '../../../src/core/engine/EntityMovementTick.js';
import { tickArrivalGate } from '../../../src/core/engine/ArrivalGate.js';
import { makeGameContext } from '../../helpers/gameContext.js';

/** Default fields for hand-built Employee test fixtures below (mirrors hireEmployee's defaults). */
const EMPLOYEE_DEFAULTS = {
  activeActionId: null,
  hunger: 100,
  fatigue: 100,
  breakNeed: 100,
  collapsing: false,
  interruptedActionPayload: null,
  ticksWorked: 0,
  restTicksRemaining: null,
  restNeedKey: null,
  taskTicksRemaining: null,
  activeTaskSkill: null,
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
} as const;

/**
 * Boarding is arrival-gated (#437): `vehicle driver` only queues the walk.
 * These fixtures spawn both vehicle and employee at (0,0), so a single
 * movement + arrival-gate tick resolves it (the employee is already there).
 */
function resolveDriverBoarding(ctx: MiningContext): void {
  tickEmployeeMovement(ctx.state!, ctx.emitter);
  tickArrivalGate(ctx.state!, ctx.emitter);
}

// ── Test context factory ──

function makeCtx(): MiningContext {
  return makeGameContext({ mineType: 'desert', seed: 1, size: 32 });
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
    ...EMPLOYEE_DEFAULTS,
    taskQueue: [],
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
    resolveDriverBoarding(ctx);

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
    resolveDriverBoarding(ctx);

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
    resolveDriverBoarding(ctx);

    const result = vehicleCommand(ctx, ['list'], {});

    const lines = result.output!.split('\n');
    const vehicleLine = lines.find(l => l.includes(`[${vehicleId}]`));
    expect(vehicleLine).toBeDefined();
    expect(vehicleLine).toContain(`driver:#${employeeId}`);
  });
});
