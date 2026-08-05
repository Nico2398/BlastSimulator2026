import { describe, it, expect } from 'vitest';
import { computeVehicleStatus } from '../../../src/core/entities/VehicleStatus.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100, task: 'idle',
    targetX: 0, targetZ: 0, driverId: null, state: 'idle', payloadKg: 0,
    waitingTicks: 0, moveConsecutiveFailures: 0, isMoveStuck: false,
    haulingFragmentId: null, haulingPhase: null, haulingDepotBuildingId: null,
    ...overrides,
  };
}

describe('computeVehicleStatus', () => {
  it('reports idle by default', () => {
    expect(computeVehicleStatus(makeVehicle())).toEqual({ kind: 'idle', ticks: null, haulingPhase: null, task: null });
  });

  it('reports broken, taking priority over every other field', () => {
    const v = makeVehicle({ state: 'broken', isMoveStuck: true, haulingPhase: 'to_depot' });
    expect(computeVehicleStatus(v).kind).toBe('broken');
  });

  it('reports stuck with the waiting-ticks count, even mid-haul', () => {
    const v = makeVehicle({ isMoveStuck: true, waitingTicks: 14, haulingPhase: 'to_fragment' });
    const status = computeVehicleStatus(v);
    expect(status.kind).toBe('stuck');
    expect(status.ticks).toBe(14);
  });

  it('reports waiting with the waiting-ticks count', () => {
    const v = makeVehicle({ state: 'waiting', waitingTicks: 5 });
    const status = computeVehicleStatus(v);
    expect(status.kind).toBe('waiting');
    expect(status.ticks).toBe(5);
  });

  it('reports hauling with the current phase', () => {
    const v = makeVehicle({ state: 'moving', haulingPhase: 'to_depot' });
    const status = computeVehicleStatus(v);
    expect(status.kind).toBe('hauling');
    expect(status.haulingPhase).toBe('to_depot');
  });

  it('reports working with the real task', () => {
    const v = makeVehicle({ state: 'working', task: 'drilling' });
    const status = computeVehicleStatus(v);
    expect(status.kind).toBe('working');
    expect(status.task).toBe('drilling');
  });

  it('reports moving when not hauling', () => {
    expect(computeVehicleStatus(makeVehicle({ state: 'moving' })).kind).toBe('moving');
  });
});
