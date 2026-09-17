// BlastSimulator2026 — Tests for ArrivalEffects (#1091)
//
// haul_load/haul_unload/boulder_split are the three arrival effects an
// itinerary leg's `{ kind: 'effect' }` ArrivalStep can name — the mutations
// HaulingTask.ts's tickHaulingProgress and BoulderBreaking.ts's
// tickBreakProgress used to drive themselves from a per-tick phase machine.
// applyHaulLoad/applyBoulderSplit read which fragment to act on off the
// vehicle's `reservedForActionId` PendingAction's own `payload.fragmentId`
// (see ArrivalEffects.ts's own doc comments: "the fragment named by the
// vehicle's active haul_debris/fragment_debris action"); applyHaulUnload
// reads it straight off `vehicle.payload.fragmentId`, since load already put
// it there.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState, PendingAction } from '../../../src/core/state/GameState.js';
import { purchaseVehicle, type Vehicle } from '../../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { OVERSIZED_FRAGMENT_THRESHOLD, isOversized } from '../../../src/core/mining/BlastCalc.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import {
  applyHaulLoad,
  applyHaulUnload,
  applyBoulderSplit,
  applyArrivalEffect,
} from '../../../src/core/engine/ArrivalEffects.js';

const SEED = 42;

function makeFragment(id: number, x: number, z: number, volume = 0.3, mass = 1000): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume,
    mass,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
  };
}

function makeFlatNavGrid(size: number): NavGrid {
  const cells: NavCell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, (): NavCell => ({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false })));
  return new NavGrid(size, size, cells, 0);
}

/** A debris_hauler with a licensed driver boarded, positioned at (x, z). */
function makeDrivenHauler(state: GameState, x = 0, z = 0): { vehicle: Vehicle; driverId: number } {
  const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', x, z);
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driver', rng, x, z);
  assignSkill(state.employees, employee.id, 'driving.truck', 1);
  vehicle.occupantIds = [employee.id];
  employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
  return { vehicle, driverId: employee.id };
}

/** A rock_fragmenter with a licensed driver boarded, positioned at (x, z). */
function makeDrivenFragmenter(state: GameState, x = 0, z = 0): { vehicle: Vehicle; driverId: number } {
  const { vehicle } = purchaseVehicle(state.vehicles, 'rock_fragmenter', x, z);
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driver', rng, x, z);
  assignSkill(state.employees, employee.id, 'driving.excavator', 1);
  vehicle.occupantIds = [employee.id];
  employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
  return { vehicle, driverId: employee.id };
}

/** Installs a haul_debris/fragment_debris PendingAction and reserves `vehicle` for it. */
function reserveFragmentAction(
  state: GameState,
  vehicle: Vehicle,
  driverId: number,
  type: 'haul_debris' | 'fragment_debris',
  fragmentId: number,
  target: { x: number; z: number },
): PendingAction {
  const action: PendingAction = {
    id: 500 + fragmentId,
    type,
    requiredSkill: null,
    requiredVehicleRole: type === 'haul_debris' ? 'debris_hauler' : 'rock_fragmenter',
    targetX: target.x,
    targetZ: target.z,
    targetY: 0,
    payload: { fragmentId },
    targetEmployeeId: driverId,
    status: 'in_progress',
    holderId: driverId,
    queuedAtTick: 0,
  };
  state.pendingActions.push(action);
  vehicle.reservedForActionId = action.id;
  return action;
}

// ── applyHaulLoad ────────────────────────────────────────────────────────────

describe('applyHaulLoad', () => {
  it('moves an on-ground fragment onto vehicle.payload, frees its nav-grid occupancy, and returns true', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const { vehicle, driverId } = makeDrivenHauler(state, 5, 5);
    const fragment = makeFragment(1, 5, 5, 0.3, 850);
    addBlastFragments(state.logistics, [fragment], state.navGrid);
    reserveFragmentAction(state, vehicle, driverId, 'haul_debris', 1, { x: 5, z: 5 });
    expect(state.navGrid.cellAt(5, 5)!.fragmentOccupancy).toBe(1);

    const result = applyHaulLoad(state, vehicle);

    expect(result).toBe(true);
    expect(vehicle.payload).toEqual({ fragmentId: 1, massKg: 850 });
    expect(state.logistics.fragments[0]!.state).toBe('in_transit');
    expect(state.navGrid.cellAt(5, 5)!.fragmentOccupancy).toBe(0);
  });

  it('returns false and leaves payload null when the fragment is already gone (picked up/removed elsewhere)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle, driverId } = makeDrivenHauler(state, 5, 5);
    // No fragment ever added — reservedForActionId names a fragmentId that
    // never resolves to anything in state.logistics.fragments.
    reserveFragmentAction(state, vehicle, driverId, 'haul_debris', 1, { x: 5, z: 5 });

    const result = applyHaulLoad(state, vehicle);

    expect(result).toBe(false);
    expect(vehicle.payload).toBeNull();
  });

  it('returns false without mutating when the named fragment is already in_transit (claimed by another vehicle)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle, driverId } = makeDrivenHauler(state, 5, 5);
    const fragment = makeFragment(1, 5, 5);
    addBlastFragments(state.logistics, [fragment]);
    state.logistics.fragments[0]!.state = 'in_transit';
    state.logistics.fragments[0]!.vehicleId = '999';
    reserveFragmentAction(state, vehicle, driverId, 'haul_debris', 1, { x: 5, z: 5 });

    const result = applyHaulLoad(state, vehicle);

    expect(result).toBe(false);
    expect(vehicle.payload).toBeNull();
    expect(state.logistics.fragments[0]!.vehicleId).toBe('999');
  });

  it('returns false without mutating when storage has no room for the fragment\'s mass', () => {
    const state = createGame({ seed: SEED });
    state.logistics.storageCapacityKg = 100;
    const { vehicle, driverId } = makeDrivenHauler(state, 5, 5);
    const fragment = makeFragment(1, 5, 5, 0.3, 5000);
    addBlastFragments(state.logistics, [fragment]);
    reserveFragmentAction(state, vehicle, driverId, 'haul_debris', 1, { x: 5, z: 5 });

    const result = applyHaulLoad(state, vehicle);

    expect(result).toBe(false);
    expect(vehicle.payload).toBeNull();
    expect(state.logistics.fragments[0]!.state).toBe('on_ground');
  });

  it('returns false when the vehicle has no reserved action to name a fragment at all', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = makeDrivenHauler(state, 5, 5);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);
    vehicle.reservedForActionId = null;

    const result = applyHaulLoad(state, vehicle);

    expect(result).toBe(false);
    expect(vehicle.payload).toBeNull();
  });
});

// ── applyHaulUnload ──────────────────────────────────────────────────────────

describe('applyHaulUnload', () => {
  it('delivers the payload fragment to storage, credits collectedOre, and clears payload — returns true', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = makeDrivenHauler(state, 10, 10);
    const fragment = makeFragment(1, 5, 5, 0.3, 1200);
    fragment.oreDensities = { blingite: 0.5 };
    addBlastFragments(state.logistics, [fragment]);
    state.logistics.fragments[0]!.state = 'in_transit';
    state.logistics.fragments[0]!.vehicleId = String(vehicle.id);
    vehicle.payload = { fragmentId: 1, massKg: 1200 };
    const storedBefore = state.logistics.storedMassKg;

    const result = applyHaulUnload(state, vehicle);

    expect(result).toBe(true);
    expect(state.logistics.fragments[0]!.state).toBe('stored');
    expect(state.logistics.storedMassKg).toBe(storedBefore + 1200);
    expect(state.collectedOre['blingite']).toBeGreaterThan(0);
    expect(vehicle.payload).toBeNull();
  });

  it('returns false without mutating collectedOre/storage when vehicle.payload is already null', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = makeDrivenHauler(state, 10, 10);
    const storedBefore = state.logistics.storedMassKg;
    const collectedBefore = { ...state.collectedOre };
    vehicle.payload = null;

    const result = applyHaulUnload(state, vehicle);

    expect(result).toBe(false);
    expect(vehicle.payload).toBeNull();
    expect(state.logistics.storedMassKg).toBe(storedBefore);
    expect(state.collectedOre).toEqual(collectedBefore);
  });

  it('returns false and leaves payload untouched when the named fragment is not actually in_transit', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = makeDrivenHauler(state, 10, 10);
    // Fragment named by payload was never tracked at all (e.g. returned to
    // ground and re-picked by someone else, or a stale payload).
    vehicle.payload = { fragmentId: 999, massKg: 500 };

    const result = applyHaulUnload(state, vehicle);

    expect(result).toBe(false);
    expect(vehicle.payload).toEqual({ fragmentId: 999, massKg: 500 });
  });
});

// ── applyBoulderSplit ────────────────────────────────────────────────────────

describe('applyBoulderSplit', () => {
  it('removes the original oversized fragment, adds its split pieces on_ground with fresh nav-grid occupancy, and returns true', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const { vehicle, driverId } = makeDrivenFragmenter(state, 5, 5);
    const fragment = makeFragment(1, 5, 5, 1.3, 2600);
    fragment.oreDensities = { blingite: 0.4, cruarium: 0.1 };
    addBlastFragments(state.logistics, [fragment], state.navGrid);
    reserveFragmentAction(state, vehicle, driverId, 'fragment_debris', 1, { x: 5, z: 5 });
    expect(state.navGrid.cellAt(5, 5)!.fragmentOccupancy).toBe(1);

    const result = applyBoulderSplit(state, vehicle);

    expect(result).toBe(true);
    expect(state.logistics.fragments.some(f => f.fragment.id === 1)).toBe(false);

    const pieces = state.logistics.fragments;
    expect(pieces.length).toBeGreaterThan(0);
    let totalVolume = 0;
    let totalMass = 0;
    for (const p of pieces) {
      expect(p.state).toBe('on_ground');
      expect(isOversized(p.fragment.volume)).toBe(false);
      expect(p.fragment.rockId).toBe(fragment.rockId);
      totalVolume += p.fragment.volume;
      totalMass += p.fragment.mass;
    }
    expect(Math.abs(totalVolume - fragment.volume)).toBeLessThan(1e-9);
    expect(Math.abs(totalMass - fragment.mass)).toBeLessThan(1e-9);
    expect(state.navGrid.cellAt(5, 5)!.fragmentOccupancy).toBe(pieces.length);
  });

  it('returns false and adds nothing when the named boulder is already gone', () => {
    const state = createGame({ seed: SEED });
    const { vehicle, driverId } = makeDrivenFragmenter(state, 5, 5);
    reserveFragmentAction(state, vehicle, driverId, 'fragment_debris', 1, { x: 5, z: 5 });

    const result = applyBoulderSplit(state, vehicle);

    expect(result).toBe(false);
    expect(state.logistics.fragments).toHaveLength(0);
  });

  it('returns false when the vehicle has no reserved action to name a boulder at all', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = makeDrivenFragmenter(state, 5, 5);
    const oversized = makeFragment(1, 5, 5, OVERSIZED_FRAGMENT_THRESHOLD + 1);
    addBlastFragments(state.logistics, [oversized]);
    vehicle.reservedForActionId = null;

    const result = applyBoulderSplit(state, vehicle);

    expect(result).toBe(false);
    expect(state.logistics.fragments.some(f => f.fragment.id === 1)).toBe(true);
  });
});

// ── applyArrivalEffect — dispatch ────────────────────────────────────────────

describe('applyArrivalEffect', () => {
  it('dispatches "haul_load" to applyHaulLoad', () => {
    const state = createGame({ seed: SEED });
    const { vehicle, driverId } = makeDrivenHauler(state, 5, 5);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 0.3, 900)]);
    reserveFragmentAction(state, vehicle, driverId, 'haul_debris', 1, { x: 5, z: 5 });

    const result = applyArrivalEffect(state, vehicle, 'haul_load');

    expect(result).toBe(true);
    expect(vehicle.payload).toEqual({ fragmentId: 1, massKg: 900 });
  });

  it('dispatches "haul_unload" to applyHaulUnload', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = makeDrivenHauler(state, 10, 10);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 0.3, 900)]);
    state.logistics.fragments[0]!.state = 'in_transit';
    state.logistics.fragments[0]!.vehicleId = String(vehicle.id);
    vehicle.payload = { fragmentId: 1, massKg: 900 };

    const result = applyArrivalEffect(state, vehicle, 'haul_unload');

    expect(result).toBe(true);
    expect(vehicle.payload).toBeNull();
    expect(state.logistics.fragments[0]!.state).toBe('stored');
  });

  it('dispatches "boulder_split" to applyBoulderSplit', () => {
    const state = createGame({ seed: SEED });
    const { vehicle, driverId } = makeDrivenFragmenter(state, 5, 5);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.3, 2600)]);
    reserveFragmentAction(state, vehicle, driverId, 'fragment_debris', 1, { x: 5, z: 5 });

    const result = applyArrivalEffect(state, vehicle, 'boulder_split');

    expect(result).toBe(true);
    expect(state.logistics.fragments.some(f => f.fragment.id === 1)).toBe(false);
  });

  it('returns false for an unknown effect id without throwing', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = makeDrivenHauler(state, 5, 5);

    expect(() => applyArrivalEffect(state, vehicle, 'not_a_real_effect')).not.toThrow();
    expect(applyArrivalEffect(state, vehicle, 'not_a_real_effect')).toBe(false);
  });
});
