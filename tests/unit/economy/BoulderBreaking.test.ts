// BlastSimulator2026 — Tests for BoulderBreaking (issue #484)
//
// requestBreakBoulder dispatches a rock_fragmenter toward an oversized
// on-ground fragment without breaking it immediately; tickBreakProgress
// splits it into sub-fragments (via fragmentBoulder) only on arrival.
// Mirrors HaulingTask.test.ts's shape (eligibility gate, request, per-tick
// progress) for the break workflow instead of the haul one.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { requestBreakBoulder, tickBreakProgress } from '../../../src/core/economy/BoulderBreaking.js';
import { fragmentApproachCell } from '../../../src/core/economy/FragmentApproach.js';
import { isOversized, OVERSIZED_FRAGMENT_THRESHOLD } from '../../../src/core/mining/BlastCalc.js';

const SEED = 42;

function makeFragment(id: number, x: number, z: number, volume = 1.0, mass = 1000): FragmentData {
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

/** A driverless rock_fragmenter with no active break. */
function makeIdleFragmenter(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  return purchaseVehicle(state.vehicles, 'rock_fragmenter', x, z).vehicle;
}

/** A rock_fragmenter with a licensed driver already boarded (driverId set). */
function makeDrivenFragmenter(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  const vehicle = makeIdleFragmenter(state, x, z);
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driver', rng);
  assignSkill(state.employees, employee.id, 'driving.excavator', 1);
  vehicle.driverId = employee.id;
  return vehicle;
}

// ── requestBreakBoulder — precondition failures ─────────────────────────────

describe('requestBreakBoulder — precondition failures', () => {
  it('rejects an unknown vehicle ID', () => {
    const state = createGame({ seed: SEED });
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);

    const result = requestBreakBoulder(state, 9999, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a debris_hauler (not a rock_fragmenter)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    assignSkill(state.employees, employee.id, 'driving.truck', 1);
    vehicle.driverId = employee.id;
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);

    const result = requestBreakBoulder(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a rock_fragmenter with driverId: null', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeIdleFragmenter(state);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);

    const result = requestBreakBoulder(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a rock_fragmenter already mid-break (breakPhase !== null)', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state);
    vehicle.breakFragmentId = 999;
    vehicle.breakPhase = 'to_boulder';
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);

    const result = requestBreakBoulder(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a fragment ID that does not exist', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state);

    const result = requestBreakBoulder(state, vehicle.id, 9999);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a fragment that is not on_ground (already in_transit)', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);
    state.logistics.fragments[0]!.state = 'in_transit';

    const result = requestBreakBoulder(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects an on_ground fragment whose volume is at/below the oversized threshold', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, OVERSIZED_FRAGMENT_THRESHOLD)]);

    const result = requestBreakBoulder(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ── requestBreakBoulder — happy path defers movement/breaking ──────────────

describe('requestBreakBoulder — happy path', () => {
  it('sets break intent toward the fragment approach cell without breaking it immediately', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state, 0, 0);
    const fragment = makeFragment(1, 5, 7, 1.0);
    addBlastFragments(state.logistics, [fragment]);

    const result = requestBreakBoulder(state, vehicle.id, 1);
    const approach = fragmentApproachCell(fragment);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(vehicle.breakFragmentId).toBe(1);
    expect(vehicle.breakPhase).toBe('to_boulder');
    expect(vehicle.targetX).toBe(approach.x);
    expect(vehicle.targetZ).toBe(approach.z);
    // The core contract under test: no synchronous split.
    expect(state.logistics.fragments[0]!.state).toBe('on_ground');
    expect(state.logistics.fragments[0]!.fragment.id).toBe(1);
  });
});

// ── tickBreakProgress — arrival splits the boulder ──────────────────────────

describe('tickBreakProgress — arrival at the boulder', () => {
  it('replaces the boulder with sub-fragments preserving volume/mass/rock/ore, all under threshold', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state, 0, 0);
    const fragment = makeFragment(1, 5, 5, 1.3, 2600);
    fragment.oreDensities = { blingite: 0.4, cruarium: 0.1 };
    addBlastFragments(state.logistics, [fragment]);
    requestBreakBoulder(state, vehicle.id, 1);

    // Arrived: vehicle position matches the break target.
    vehicle.x = vehicle.targetX;
    vehicle.z = vehicle.targetZ;

    const brokenId = tickBreakProgress(state, vehicle);

    expect(brokenId).toBe(1);
    expect(state.logistics.fragments.some(f => f.fragment.id === 1)).toBe(false);

    const pieces = state.logistics.fragments;
    expect(pieces.length).toBeGreaterThan(0);

    let totalVolume = 0;
    let totalMass = 0;
    for (const p of pieces) {
      expect(p.state).toBe('on_ground');
      expect(isOversized(p.fragment.volume)).toBe(false);
      expect(p.fragment.rockId).toBe(fragment.rockId);
      expect(p.fragment.oreDensities).toEqual(fragment.oreDensities);
      totalVolume += p.fragment.volume;
      totalMass += p.fragment.mass;
    }

    expect(Math.abs(totalVolume - fragment.volume)).toBeLessThan(1e-9);
    expect(Math.abs(totalMass - fragment.mass)).toBeLessThan(1e-9);

    expect(vehicle.breakFragmentId).toBeNull();
    expect(vehicle.breakPhase).toBeNull();
    expect(vehicle.task).toBe('idle');
  });
});
