import { describe, it, expect } from 'vitest';
import { computeVehicleStatus } from '../../../src/core/entities/VehicleStatus.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { tickVehicle } from '../../../src/core/engine/EntityMovementTick.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { VEHICLE_OCCUPANCY_REROUTE_THRESHOLD } from '../../../src/core/config/balance.js';

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

  // ── issue #591: occupancy-escalation trigger reports 'stuck' too ──────────
  // isMoveStuck: true set via the NEW occupancy-block escalation trigger
  // (a stationary vehicle permanently occupying the next path cell, not a
  // pathfinding failure) must report exactly the same as the old
  // moveConsecutiveFailures trigger the tests above cover — computeVehicleStatus
  // only ever reads the flag, never its cause. Drives the flag through the
  // real engine (tickVehicle) rather than fabricating it directly, so this
  // actually exercises the new trigger instead of restating the pure-function
  // contract already proven above.

  it('reports stuck with the waiting-ticks count when isMoveStuck was set by the occupancy-block reroute escalation', () => {
    const state = createGame({ seed: 42 });

    // 1-cell-wide corridor (x:0..4, z:0..2) — row z=1 solid, z=0/z=2 void —
    // so no detour around an obstacle placed in the corridor can exist.
    const vg = new VoxelGrid(5, 2, 3);
    for (let x = 0; x < 5; x++) {
      vg.setVoxel(x, 0, 1, {
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        density: 1.0,
        oreDensities: {},
        fractureModifier: 1.0,
      });
    }
    state.navGrid = NavGrid.buildNavGrid(vg, [], []);

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 1);
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 4;
    vehicle.targetZ = 1;

    // Stationary blocker sitting on the only possible route — never ticked.
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 1);
    blocker.task = 'idle';
    blocker.state = 'idle';

    const emitter = new EventEmitter();
    for (let i = 0; i < 1 + VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 2; i++) {
      tickVehicle(state, vehicle, emitter);
    }

    expect(vehicle.isMoveStuck).toBe(true); // sanity: the fixture actually escalated

    const status = computeVehicleStatus(vehicle);
    expect(status.kind).toBe('stuck');
    expect(status.ticks).toBe(vehicle.waitingTicks);
  });
});
