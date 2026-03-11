import { describe, it, expect } from 'vitest';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import {
  createLogisticsState,
  addBlastFragments,
  pickupFragment,
  deliverToDepot,
  sellFragment,
  getFragmentCounts,
} from '../../../src/core/economy/Logistics.js';

function makeFragment(id: number, mass: number = 100): FragmentData {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    volume: mass / 2.5,
    mass,
    rockId: 'sandite',
    oreDensities: { dirtite: 0.3 },
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
  };
}

describe('Fragment logistics', () => {
  it('after blast, fragments are in on_ground state', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1), makeFragment(2), makeFragment(3)]);

    const counts = getFragmentCounts(state);
    expect(counts.onGround).toBe(3);
    expect(counts.inTransit).toBe(0);
    expect(counts.stored).toBe(0);
  });

  it('pickupFragment moves fragment to in_transit', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1)]);

    const ok = pickupFragment(state, 1, 'truck-01');
    expect(ok).toBe(true);

    const counts = getFragmentCounts(state);
    expect(counts.onGround).toBe(0);
    expect(counts.inTransit).toBe(1);
  });

  it('delivering fragment to depot moves it to stored', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1, 50)]);
    pickupFragment(state, 1, 'truck-01');
    deliverToDepot(state, 1);

    const counts = getFragmentCounts(state);
    expect(counts.stored).toBe(1);
    expect(state.storedMassKg).toBe(50);
  });

  it('selling fragment against contract credits income and reduces quantity', () => {
    const state = createLogisticsState();
    addBlastFragments(state, [makeFragment(1, 200)]);
    pickupFragment(state, 1, 'truck-01');
    deliverToDepot(state, 1);

    const result = sellFragment(state, 1);
    expect(result).not.toBeNull();
    expect(result!.mass).toBe(200);
    expect(result!.oreDensities).toEqual({ dirtite: 0.3 });

    const counts = getFragmentCounts(state);
    expect(counts.total).toBe(0);
    expect(state.storedMassKg).toBe(0);
  });

  it('no available storage → cannot pick up more fragments', () => {
    const state = createLogisticsState(150); // Only 150kg capacity
    addBlastFragments(state, [makeFragment(1, 100), makeFragment(2, 100)]);

    // First pickup succeeds
    const ok1 = pickupFragment(state, 1, 'truck-01');
    expect(ok1).toBe(true);
    deliverToDepot(state, 1);

    // Second pickup fails — would exceed capacity
    const ok2 = pickupFragment(state, 2, 'truck-01');
    expect(ok2).toBe(false);

    const counts = getFragmentCounts(state);
    expect(counts.onGround).toBe(1);
    expect(counts.stored).toBe(1);
  });
});
