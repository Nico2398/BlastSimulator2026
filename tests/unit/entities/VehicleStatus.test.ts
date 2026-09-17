import { describe, it, expect } from 'vitest';
import { computeVehicleStatus } from '../../../src/core/entities/VehicleStatus.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';
import { moveTo } from '../../../src/core/engine/MoveTo.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { VEHICLE_OCCUPANCY_REROUTE_THRESHOLD } from '../../../src/core/config/balance.js';

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100, task: 'idle',
    targetX: 0, targetZ: 0, state: 'idle', payload: null,
    waitingTicks: 0, moveConsecutiveFailures: 0, isMoveStuck: false,
    reservedForActionId: null,
    occupantIds: [],
    ...overrides,
  };
}

describe('computeVehicleStatus', () => {
  it('reports idle by default', () => {
    expect(computeVehicleStatus(makeVehicle())).toEqual({ kind: 'idle', ticks: null, haulingPhase: null, task: null });
  });

  it('reports broken, taking priority over every other field', () => {
    // #1091: mid-haul (to_depot leg — cargo already loaded) is now
    // reservedForActionId set + payload set, replacing the deleted
    // haulingPhase field.
    const v = makeVehicle({ state: 'broken', isMoveStuck: true, reservedForActionId: 1, payload: { fragmentId: 1, massKg: 100 } });
    expect(computeVehicleStatus(v).kind).toBe('broken');
  });

  it('reports stuck with the waiting-ticks count, even mid-haul', () => {
    // #1091: mid-haul (to_fragment leg — not yet loaded) is reservedForActionId
    // set with payload still null.
    const v = makeVehicle({ isMoveStuck: true, waitingTicks: 14, reservedForActionId: 1, payload: null });
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
    // #1091: a debris_hauler reserved for an action is "hauling" for its
    // whole itinerary — payload set distinguishes the 'to_depot' leg
    // (already loaded) from 'to_fragment' (not yet loaded).
    const v = makeVehicle({ state: 'moving', reservedForActionId: 1, payload: { fragmentId: 1, massKg: 100 } });
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
    // #1089: only an employee moves — a real, licensed, boarded driver with a
    // genuine drive-leg itinerary is what tickLocomotion actually walks
    // (mirrors the old #947 driver-required-to-advance rule, driven through
    // the new mover instead of a dangling fake employee id).
    const { employee: driver } = hireEmployee(state.employees, 'driller', new Random(1), 0, 1);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    // Stationary blocker sitting on the only possible route — never ticked.
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 1);
    blocker.task = 'idle';
    blocker.state = 'idle';

    const emitter = new EventEmitter();
    const moveResult = moveTo(state, driver.id, { x: 4, z: 1 });
    expect(moveResult.success).toBe(true);
    for (let i = 0; i < 1 + VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 2; i++) {
      tickLocomotion(state, emitter);
    }

    expect(vehicle.isMoveStuck).toBe(true); // sanity: the fixture actually escalated

    const status = computeVehicleStatus(vehicle);
    expect(status.kind).toBe('stuck');
    expect(status.ticks).toBe(vehicle.waitingTicks);
  });
});
