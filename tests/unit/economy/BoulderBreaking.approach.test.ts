// BlastSimulator2026 — Tests for BoulderBreaking's position-gated approach
// behaviour (issue #484): requestBreakBoulder sets intent only; the split
// happens strictly on the tickBreakProgress call where the vehicle's
// position matches the approach cell — never mid-transit, never at request
// time. Mirrors HaulingTask.test.ts's "travelling" / "arrival at fragment"
// split, plus a vanished-target abort case unique to the break workflow.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { requestBreakBoulder, tickBreakProgress } from '../../../src/core/economy/BoulderBreaking.js';
import { fragmentApproachCell } from '../../../src/core/economy/FragmentApproach.js';

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

function makeDrivenFragmenter(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  const vehicle = purchaseVehicle(state.vehicles, 'rock_fragmenter', x, z).vehicle;
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driver', rng);
  assignSkill(state.employees, employee.id, 'driving.excavator', 1);
  vehicle.driverId = employee.id;
  return vehicle;
}

// ── requestBreakBoulder — no synchronous mutation of logistics ─────────────

describe('requestBreakBoulder — defers the split', () => {
  it('changes only vehicle intent fields, leaving the tracked fragment untouched', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);

    requestBreakBoulder(state, vehicle.id, 1);

    expect(state.logistics.fragments.length).toBe(1);
    expect(state.logistics.fragments[0]!.fragment.id).toBe(1);
    expect(state.logistics.fragments[0]!.state).toBe('on_ground');
    expect(state.logistics.fragments[0]!.fragment.volume).toBe(1.0);
  });
});

// ── tickBreakProgress — no-op while travelling ──────────────────────────────

describe('tickBreakProgress — while travelling', () => {
  it('does not split the fragment while the vehicle has not yet reached the approach cell', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);
    requestBreakBoulder(state, vehicle.id, 1);

    // Still en route: position does not match the break target.
    vehicle.x = 1;
    vehicle.z = 1;

    tickBreakProgress(state, vehicle);

    expect(state.logistics.fragments.length).toBe(1);
    expect(state.logistics.fragments[0]!.fragment.id).toBe(1);
    expect(state.logistics.fragments[0]!.state).toBe('on_ground');
    expect(vehicle.breakPhase).toBe('to_boulder');
  });
});

// ── tickBreakProgress — split happens strictly on arrival ──────────────────

describe('tickBreakProgress — arrival', () => {
  it('splits the fragment strictly on the call where position matches the target, not before', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state, 0, 0);
    const fragment = makeFragment(1, 5, 5, 1.0);
    addBlastFragments(state.logistics, [fragment]);
    requestBreakBoulder(state, vehicle.id, 1);

    // Not yet arrived — one tick short of the target.
    vehicle.x = 1;
    vehicle.z = 1;
    tickBreakProgress(state, vehicle);
    expect(state.logistics.fragments.some(f => f.fragment.id === 1)).toBe(true);

    // Now arrived at the approach cell.
    const approach = fragmentApproachCell(fragment);
    vehicle.x = approach.x;
    vehicle.z = approach.z;
    tickBreakProgress(state, vehicle);

    expect(state.logistics.fragments.some(f => f.fragment.id === 1)).toBe(false);
    expect(state.logistics.fragments.length).toBeGreaterThan(0);
  });
});

// ── tickBreakProgress — target fragment vanishes before arrival ────────────

describe('tickBreakProgress — target fragment vanishes before arrival', () => {
  it('aborts cleanly: clears break intent, returns to idle, does not throw, attempts no split', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenFragmenter(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1.0)]);
    requestBreakBoulder(state, vehicle.id, 1);

    // Fragment removed by something else before the vehicle arrives.
    state.logistics.fragments.length = 0;

    // Vehicle has "arrived" at the now-stale target.
    vehicle.x = vehicle.targetX;
    vehicle.z = vehicle.targetZ;

    expect(() => tickBreakProgress(state, vehicle)).not.toThrow();
    expect(vehicle.breakFragmentId).toBeNull();
    expect(vehicle.breakPhase).toBeNull();
    expect(vehicle.task).toBe('idle');
    expect(state.logistics.fragments.length).toBe(0);
  });
});
