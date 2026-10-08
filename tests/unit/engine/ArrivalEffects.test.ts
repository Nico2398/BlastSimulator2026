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
// reads it straight off `vehicle.cargo` ids, since load already put
// them there.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState, PendingAction } from '../../../src/core/state/GameState.js';
import { purchaseVehicle, type Vehicle } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
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
    origin: { x, y: 0, z },
  };
}

function makeFlatNavGrid(size: number): NavGrid {
  const cells: NavCell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, (): NavCell => ({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false })));
  return new NavGrid(size, size, cells, 0);
}

/** A debris_hauler with a licensed driver boarded, positioned at (x, z). */
function makeDrivenHauler(state: GameState, x = 0, z = 0): { vehicle: Vehicle; driverId: number } {
  state.logistics.storageCapacityKg = 5000; // fresh state has no warehouse capacity (#1369)
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
  reserveVehicle(state.vehicles, vehicle.id, action.id);
  return action;
}

// ── applyHaulLoad — extra pickup (#1370) ────────────────────────────────────

describe('applyHaulLoad with targetId (extra pickup, #1370)', () => {
  function setupExtra(extraMass = 500, extraVolume = 0.3) {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const { vehicle, driverId } = makeDrivenHauler(state, 5, 5);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 0.3, 1000), makeFragment(2, 6, 5, extraVolume, extraMass)], state.navGrid);
    reserveFragmentAction(state, vehicle, driverId, 'haul_debris', 1, { x: 5, z: 5 });
    const extraAction = queueHaulAction(state, 2);
    return { state, vehicle, extraAction };
  }

  function queueHaulAction(state: GameState, fragmentId: number): PendingAction {
    const action: PendingAction = {
      id: 700 + fragmentId, type: 'haul_debris', requiredSkill: null, requiredVehicleRole: 'debris_hauler',
      targetX: 6, targetZ: 5, targetY: 0, payload: { fragmentId }, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0,
    };
    state.pendingActions.push(action);
    return action;
  }

  it('loads the extra fragment and consumes its own queued action, leaving the reserved one', () => {
    const { state, vehicle, extraAction } = setupExtra();

    expect(applyHaulLoad(state, vehicle, undefined, 2)).toBe(true);

    expect(vehicle.cargo).toEqual([{ fragmentId: 2, massKg: 500 }]);
    expect(state.pendingActions.some(a => a.id === extraAction.id)).toBe(false);
    expect(state.pendingActions.some(a => a.id === 501)).toBe(true);
  });

  it('soft-skips (true, nothing loaded) when the extra would exceed vehicle capacity', () => {
    const { state, vehicle, extraAction } = setupExtra(1_000_000);

    expect(applyHaulLoad(state, vehicle, undefined, 2)).toBe(true);

    expect(vehicle.cargo).toEqual([]);
    expect(state.logistics.fragments.find(f => f.fragment.id === 2)!.state).toBe('on_ground');
    expect(state.pendingActions.some(a => a.id === extraAction.id)).toBe(true);
  });

  it('soft-skips when the extra action is already claimed', () => {
    const { state, vehicle, extraAction } = setupExtra();
    extraAction.holderId = 99;

    expect(applyHaulLoad(state, vehicle, undefined, 2)).toBe(true);

    expect(vehicle.cargo).toEqual([]);
    expect(state.logistics.fragments.find(f => f.fragment.id === 2)!.state).toBe('on_ground');
  });

  it('soft-skips when the extra has no queued action or is gone', () => {
    const { state, vehicle, extraAction } = setupExtra();
    state.pendingActions = state.pendingActions.filter(a => a.id !== extraAction.id);
    expect(applyHaulLoad(state, vehicle, undefined, 2)).toBe(true);
    expect(applyHaulLoad(state, vehicle, undefined, 77)).toBe(true);
    expect(vehicle.cargo).toEqual([]);
  });
});

// ── applyHaulLoad ────────────────────────────────────────────────────────────

describe('applyHaulLoad', () => {
  it('moves an on-ground fragment onto vehicle.cargo, frees its nav-grid occupancy, and returns true', () => {
    const state = createGame({ seed: SEED });
    state.logistics.storageCapacityKg = 5000; // fresh state holds 0 kg until a warehouse syncs capacity (#1369)
    state.navGrid = makeFlatNavGrid(20);
    const { vehicle, driverId } = makeDrivenHauler(state, 5, 5);
    const fragment = makeFragment(1, 5, 5, 0.3, 850);
    addBlastFragments(state.logistics, [fragment], state.navGrid);
    reserveFragmentAction(state, vehicle, driverId, 'haul_debris', 1, { x: 5, z: 5 });
    expect(state.navGrid.cellAt(5, 5)!.fragmentOccupancy).toBe(1);

    const result = applyHaulLoad(state, vehicle);

    expect(result).toBe(true);
    expect(vehicle.cargo).toEqual([{ fragmentId: 1, massKg: 850 }]);
    expect(state.logistics.fragments[0]!.state).toBe('in_transit');
    expect(state.navGrid.cellAt(5, 5)!.fragmentOccupancy).toBe(0);
  });

  it('returns false and leaves cargo empty when the fragment is already gone (picked up/removed elsewhere)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle, driverId } = makeDrivenHauler(state, 5, 5);
    // No fragment ever added — reservedForActionId names a fragmentId that
    // never resolves to anything in state.logistics.fragments.
    reserveFragmentAction(state, vehicle, driverId, 'haul_debris', 1, { x: 5, z: 5 });

    const result = applyHaulLoad(state, vehicle);

    expect(result).toBe(false);
    expect(vehicle.cargo).toEqual([]);
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
    expect(vehicle.cargo).toEqual([]);
    expect(state.logistics.fragments[0]!.vehicleId).toBe('999');
  });

  it('returns false without mutating when storage has no room for the fragment\'s mass', () => {
    const state = createGame({ seed: SEED });
    const { vehicle, driverId } = makeDrivenHauler(state, 5, 5);
    state.logistics.storageCapacityKg = 100;
    const fragment = makeFragment(1, 5, 5, 0.3, 5000);
    addBlastFragments(state.logistics, [fragment]);
    reserveFragmentAction(state, vehicle, driverId, 'haul_debris', 1, { x: 5, z: 5 });

    const result = applyHaulLoad(state, vehicle);

    expect(result).toBe(false);
    expect(vehicle.cargo).toEqual([]);
    expect(state.logistics.fragments[0]!.state).toBe('on_ground');
  });

  it('returns false when the vehicle has no reserved action to name a fragment at all', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = makeDrivenHauler(state, 5, 5);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);
    // No reservation exists at all — the default, unreserved state.

    const result = applyHaulLoad(state, vehicle);

    expect(result).toBe(false);
    expect(vehicle.cargo).toEqual([]);
  });
});

// ── applyHaulUnload ──────────────────────────────────────────────────────────

describe('applyHaulUnload', () => {
  it('delivers the cargo fragment to storage, credits collectedOre, and clears cargo — returns true', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = makeDrivenHauler(state, 10, 10);
    const fragment = makeFragment(1, 5, 5, 0.3, 1200);
    fragment.oreDensities = { blingite: 0.5 };
    addBlastFragments(state.logistics, [fragment]);
    state.logistics.fragments[0]!.state = 'in_transit';
    state.logistics.fragments[0]!.vehicleId = String(vehicle.id);
    vehicle.cargo = [{ fragmentId: 1, massKg: 1200 }];
    const storedBefore = state.logistics.storedMassKg;

    const result = applyHaulUnload(state, vehicle);

    expect(result).toBe(true);
    expect(state.logistics.fragments[0]!.state).toBe('stored');
    expect(state.logistics.storedMassKg).toBe(storedBefore + 1200);
    expect(state.collectedOre['blingite']).toBeGreaterThan(0);
    expect(vehicle.cargo).toEqual([]);
  });

  it('returns false without mutating collectedOre/storage when vehicle.cargo is already empty', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = makeDrivenHauler(state, 10, 10);
    const storedBefore = state.logistics.storedMassKg;
    const collectedBefore = { ...state.collectedOre };
    vehicle.cargo = [];

    const result = applyHaulUnload(state, vehicle);

    expect(result).toBe(false);
    expect(vehicle.cargo).toEqual([]);
    expect(state.logistics.storedMassKg).toBe(storedBefore);
    expect(state.collectedOre).toEqual(collectedBefore);
  });

  it('returns false and leaves cargo untouched when the named fragment is not actually in_transit', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = makeDrivenHauler(state, 10, 10);
    // Fragment named by cargo was never tracked at all (e.g. returned to
    // ground and re-picked by someone else, or a stale cargo entry).
    vehicle.cargo = [{ fragmentId: 999, massKg: 500 }];

    const result = applyHaulUnload(state, vehicle);

    expect(result).toBe(false);
    expect(vehicle.cargo).toEqual([{ fragmentId: 999, massKg: 500 }]);
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
    // No reservation exists at all — the default, unreserved state.

    const result = applyBoulderSplit(state, vehicle);

    expect(result).toBe(false);
    expect(state.logistics.fragments.some(f => f.fragment.id === 1)).toBe(true);
  });
});

// ── applyArrivalEffect — dispatch ────────────────────────────────────────────

describe('applyArrivalEffect', () => {
  it('dispatches "haul_load" to applyHaulLoad', () => {
    const state = createGame({ seed: SEED });
    state.logistics.storageCapacityKg = 5000; // fresh state holds 0 kg until a warehouse syncs capacity (#1369)
    const { vehicle, driverId } = makeDrivenHauler(state, 5, 5);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 0.3, 900)]);
    reserveFragmentAction(state, vehicle, driverId, 'haul_debris', 1, { x: 5, z: 5 });

    const result = applyArrivalEffect(state, vehicle, 'haul_load');

    expect(result).toBe(true);
    expect(vehicle.cargo).toEqual([{ fragmentId: 1, massKg: 900 }]);
  });

  it('dispatches "haul_unload" to applyHaulUnload', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = makeDrivenHauler(state, 10, 10);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 0.3, 900)]);
    state.logistics.fragments[0]!.state = 'in_transit';
    state.logistics.fragments[0]!.vehicleId = String(vehicle.id);
    vehicle.cargo = [{ fragmentId: 1, massKg: 900 }];

    const result = applyArrivalEffect(state, vehicle, 'haul_unload');

    expect(result).toBe(true);
    expect(vehicle.cargo).toEqual([]);
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

// ── applyHaulUnload — several cargo items in one delivery (#1370) ────────────

describe('applyHaulUnload with a multi-fragment cargo (#1370)', () => {
  function queuedHaulAction(id: number, fragmentId: number): PendingAction {
    return {
      id, type: 'haul_debris', requiredSkill: null, requiredVehicleRole: 'debris_hauler',
      targetX: 5, targetZ: 5, targetY: 0, payload: { fragmentId },
      targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0,
    };
  }

  function loadedTrip() {
    const state = createGame({ seed: SEED });
    const { vehicle, driverId } = makeDrivenHauler(state, 10, 10);
    const masses = [1200, 800, 500];
    masses.forEach((m, i) => {
      const f = makeFragment(i + 1, 5 + i, 5, 0.3, m);
      f.oreDensities = { blingite: 0.5 };
      addBlastFragments(state.logistics, [f]);
    });
    for (const tracked of state.logistics.fragments) {
      tracked.state = 'in_transit';
      tracked.vehicleId = String(vehicle.id);
    }
    vehicle.cargo = masses.map((m, i) => ({ fragmentId: i + 1, massKg: m }));
    const primary = reserveFragmentAction(state, vehicle, driverId, 'haul_debris', 1, { x: 5, z: 5 });
    // Extras' own self-dispatched haul actions, still queued.
    state.pendingActions.push(queuedHaulAction(902, 2), queuedHaulAction(903, 3));
    return { state, vehicle, primary, masses };
  }

  it('stores every item: storedMassKg grows by the whole cargo mass and every fragment is stored', () => {
    const { state, vehicle } = loadedTrip();
    const before = state.logistics.storedMassKg;

    expect(applyHaulUnload(state, vehicle)).toBe(true);

    expect(state.logistics.storedMassKg).toBe(before + 2500);
    expect(state.logistics.fragments.map(f => f.state)).toEqual(['stored', 'stored', 'stored']);
    expect(vehicle.cargo).toEqual([]);
  });

  it('credits collectedOre once per fragment', () => {
    const { state, vehicle } = loadedTrip();
    const single = createGame({ seed: SEED });
    const f = makeFragment(1, 5, 5, 0.3, 1200);
    f.oreDensities = { blingite: 0.5 };
    addBlastFragments(single.logistics, [f]);
    single.logistics.fragments[0]!.state = 'in_transit';
    const { vehicle: v2 } = makeDrivenHauler(single, 10, 10);
    v2.cargo = [{ fragmentId: 1, massKg: 1200 }];
    applyHaulUnload(single, v2);
    const perFragment = single.collectedOre['blingite']!; // same volume and density each

    applyHaulUnload(state, vehicle);

    expect(state.collectedOre['blingite']).toBeCloseTo(perFragment * 3, 6);
  });

  it('removes the haul actions of every loaded fragment', () => {
    const { state, vehicle } = loadedTrip();

    applyHaulUnload(state, vehicle);

    expect(state.pendingActions.filter(a => a.type === 'haul_debris')).toEqual([]);
  });

  it('emits vehicle:haul_delivered once per fragment', () => {
    const { state, vehicle } = loadedTrip();
    const emitter = new EventEmitter();
    const delivered: number[] = [];
    emitter.on('vehicle:haul_delivered', (p: { vehicleId: number; fragmentId: number }) => delivered.push(p.fragmentId));

    applyHaulUnload(state, vehicle, emitter);

    expect([...delivered].sort()).toEqual([1, 2, 3]);
  });

  it('returns false and changes nothing if no cargo fragment is in transit any more', () => {
    const { state, vehicle } = loadedTrip();
    for (const tracked of state.logistics.fragments) tracked.state = 'on_ground';
    const before = state.logistics.storedMassKg;

    expect(applyHaulUnload(state, vehicle)).toBe(false);
    expect(state.logistics.storedMassKg).toBe(before);
  });
});
