// BlastSimulator2026 — Tests for FragmentTaskLifecycle.ts's abortVehicleGatedFragmentWork (#974)
//
// Shared abort-on-forced-release counterpart to startVehicleGatedFragmentWork:
// cleanly unwinds whatever vehicle-gated fragment work (hauling or breaking)
// is in flight on a vehicle so a reservation can be safely released, without
// permanently losing any cargo already picked up.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { addBlastFragments, pickupFragment } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { abortVehicleGatedFragmentWork } from '../../../src/core/economy/FragmentTaskLifecycle.js';

const SEED = 42;

function makeFragment(id: number, mass = 1000): FragmentData {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    volume: 0.3,
    mass,
    rockId: 'cruite',
    oreDensities: { dirtite: 0.3 },
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
  };
}

describe('abortVehicleGatedFragmentWork', () => {
  it('hauling mid-flight with cargo already loaded: returns cargo to ground and clears haul state (no permanent mass loss)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 850)]);
    pickupFragment(state.logistics, 1, String(vehicle.id));
    vehicle.haulingFragmentId = 1;
    vehicle.haulingPhase = 'to_depot';
    vehicle.haulingDepotBuildingId = 42;
    vehicle.payloadKg = 850;
    vehicle.task = 'transport';

    abortVehicleGatedFragmentWork(state, vehicle);

    expect(vehicle.haulingPhase).toBeNull();
    expect(vehicle.haulingFragmentId).toBeNull();
    expect(vehicle.payloadKg).toBe(0);
    const cargo = state.logistics.fragments.find(f => f.fragment.id === 1)!;
    expect(cargo.state).toBe('on_ground');
    expect(cargo.vehicleId).toBeNull();
  });

  it('hauling before pickup (to_fragment phase): clears haul state and leaves the never-picked-up fragment untouched', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 850)]);
    vehicle.haulingFragmentId = 1;
    vehicle.haulingPhase = 'to_fragment';
    vehicle.haulingDepotBuildingId = 42;

    abortVehicleGatedFragmentWork(state, vehicle);

    expect(vehicle.haulingPhase).toBeNull();
    const fragment = state.logistics.fragments.find(f => f.fragment.id === 1)!;
    expect(fragment.state).toBe('on_ground');
    expect(fragment.vehicleId).toBeNull();
  });

  it('breaking mid-flight: clears break state and leaves the oversized fragment untouched (no cargo-return needed)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_fragmenter', 0, 0);
    addBlastFragments(state.logistics, [makeFragment(2, 5000)]);
    vehicle.breakFragmentId = 2;
    vehicle.breakPhase = 'to_boulder';

    abortVehicleGatedFragmentWork(state, vehicle);

    expect(vehicle.breakPhase).toBeNull();
    expect(vehicle.breakFragmentId).toBeNull();
    const fragment = state.logistics.fragments.find(f => f.fragment.id === 2)!;
    expect(fragment.state).toBe('on_ground');
  });

  it('is a no-op when neither haulingPhase nor breakPhase is set', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    const before = { ...vehicle };

    expect(() => abortVehicleGatedFragmentWork(state, vehicle)).not.toThrow();

    expect(vehicle).toEqual(before);
  });
});
