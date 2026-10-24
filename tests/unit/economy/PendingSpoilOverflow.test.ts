// BlastSimulator2026 — pendingSpoilOverflowKg (#2085): mass of rubble queued haul orders cannot place in a spoil heap.

import { describe, it, expect } from 'vitest';
import { createGame, type PendingAction } from '../../../src/core/state/GameState.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import { pendingSpoilOverflowKg } from '../../../src/core/economy/HaulDispatch.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';

function fragment(id: number, mass: number): FragmentData {
  return {
    id, position: { x: 5, y: 0, z: 5 }, volume: 0.3, mass, rockId: 'cruite', oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false, halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1, origin: { x: 5, y: 0, z: 5 },
  };
}

function order(id: number, fragmentId: number, over: Partial<PendingAction> = {}): PendingAction {
  return {
    id, type: 'haul_debris', requiredSkill: null, requiredVehicleRole: 'debris_hauler',
    targetX: 5, targetZ: 5, targetY: 0, payload: { fragmentId }, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0, ...over,
  };
}

function world(masses: number[]) {
  const state = createGame({ seed: 42 });
  addBlastFragments(state.logistics, masses.map((m, i) => fragment(i + 1, m)));
  return state;
}

describe('pendingSpoilOverflowKg', () => {
  it('is 0 with no orders', () => {
    expect(pendingSpoilOverflowKg(world([]))).toBe(0);
    expect(pendingSpoilOverflowKg(world([500]))).toBe(0);
  });

  it('sums the masses of haul_debris orders stamped spoil_heap_full', () => {
    const state = world([1000, 2500, 400]);
    state.pendingActions.push(order(1, 1, { blockedReason: 'spoil_heap_full' }), order(2, 2, { blockedReason: 'spoil_heap_full' }));
    expect(pendingSpoilOverflowKg(state)).toBe(3500);
  });

  it('ignores storage_full, other reasons and unstamped orders', () => {
    const state = world([1000, 2000, 3000, 4000]);
    state.pendingActions.push(
      order(1, 1, { blockedReason: 'storage_full' }),
      order(2, 2, { blockedReason: 'no_spoil_heap' }),
      order(3, 3),
      order(4, 4, { blockedReason: 'spoil_heap_full' }),
    );
    expect(pendingSpoilOverflowKg(state)).toBe(4000);
  });

  it('ignores non-haul_debris orders even when stamped spoil_heap_full', () => {
    const state = world([1000, 2000]);
    state.pendingActions.push(
      order(1, 1, { type: 'fragment_debris', blockedReason: 'spoil_heap_full' }),
      order(2, 2, { blockedReason: 'spoil_heap_full' }),
    );
    expect(pendingSpoilOverflowKg(state)).toBe(2000);
  });
});
