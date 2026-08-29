import { describe, it, expect } from 'vitest';
import { computeEmployeeActivity } from '../../../src/core/entities/EmployeeActivity.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Test Employee', role: 'driller', salary: 1000, morale: 60,
    unionized: false, injured: false, alive: true,
    x: 0, z: 0,
    qualifications: [],
    trainingState: null,
    activeActionId: null,
    hunger: 100, fatigue: 100, breakNeed: 100,
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
    taskQueue: [],
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100, task: 'idle',
    targetX: 0, targetZ: 0, driverId: null, state: 'idle', payloadKg: 0,
    waitingTicks: 0, moveConsecutiveFailures: 0, isMoveStuck: false,
    haulingFragmentId: null, haulingPhase: null, haulingDepotBuildingId: null,
    breakFragmentId: null, breakPhase: null, reservedForActionId: null,
    ...overrides,
  };
}

describe('computeEmployeeActivity', () => {
  it('reports idle when nothing is set', () => {
    const activity = computeEmployeeActivity(makeEmployee(), []);
    expect(activity).toEqual({ kind: 'idle', ticksRemaining: null, totalTicks: null, actionType: null, vehicleId: null });
  });

  it('reports collapsed, taking priority over everything else', () => {
    const emp = makeEmployee({ collapsing: true, taskTicksRemaining: 5, activeTaskTotalTicks: 20 });
    expect(computeEmployeeActivity(emp, []).kind).toBe('collapsed');
  });

  it('reports resting with ticksRemaining, no total (rest has none tracked)', () => {
    const emp = makeEmployee({ restTicksRemaining: 7 });
    const activity = computeEmployeeActivity(emp, []);
    expect(activity.kind).toBe('resting');
    expect(activity.ticksRemaining).toBe(7);
    expect(activity.totalTicks).toBeNull();
  });

  it('reports working with ticksRemaining, totalTicks, and actionType', () => {
    const emp = makeEmployee({
      taskTicksRemaining: 8, activeTaskTotalTicks: 20, pendingActionType: 'survey',
    });
    const activity = computeEmployeeActivity(emp, []);
    expect(activity.kind).toBe('working');
    expect(activity.ticksRemaining).toBe(8);
    expect(activity.totalTicks).toBe(20);
    expect(activity.actionType).toBe('survey');
  });

  it('reports working with totalTicks null when activeTaskTotalTicks was never set (old save)', () => {
    const emp = makeEmployee({ taskTicksRemaining: 8 });
    expect(computeEmployeeActivity(emp, []).totalTicks ?? null).toBeNull();
  });

  it('reports driving when a vehicle lists them as driver, before falling through to walking/idle', () => {
    const emp = makeEmployee({ id: 6, destinationX: null });
    const vehicles = [makeVehicle({ id: 9, driverId: 6 })];
    const activity = computeEmployeeActivity(emp, vehicles);
    expect(activity.kind).toBe('driving');
    expect(activity.vehicleId).toBe(9);
  });

  it('working takes priority over driving (e.g. a driver dispatched to foot work mid-tick)', () => {
    const emp = makeEmployee({ id: 6, taskTicksRemaining: 3 });
    const vehicles = [makeVehicle({ id: 9, driverId: 6 })];
    expect(computeEmployeeActivity(emp, vehicles).kind).toBe('working');
  });

  it('reports walking with the pending action type when destinationX is set', () => {
    const emp = makeEmployee({ destinationX: 12, destinationZ: 4, pendingActionType: 'drill_hole' });
    const activity = computeEmployeeActivity(emp, []);
    expect(activity.kind).toBe('walking');
    expect(activity.actionType).toBe('drill_hole');
  });

  it('reports walking when only destinationZ is set', () => {
    const emp = makeEmployee({ destinationX: null, destinationZ: 4 });
    expect(computeEmployeeActivity(emp, []).kind).toBe('walking');
  });

  it('reports walking with a null actionType when walking to rest or to board a vehicle', () => {
    const emp = makeEmployee({ destinationX: 5, destinationZ: 5, pendingDriverVehicleId: 2 });
    const activity = computeEmployeeActivity(emp, []);
    expect(activity.kind).toBe('walking');
    expect(activity.actionType).toBeNull();
  });
});
