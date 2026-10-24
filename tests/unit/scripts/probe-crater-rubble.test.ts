// #2062: craterRubbleCounts classifies on-ground crater fragments in one pass.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GameState } from '../../../src/core/state/GameState.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';

// sealedFragmentIdsOf reads a per-state WeakMap filled by a dispatch pass; the test controls it directly.
let sealedIds: ReadonlySet<number> | undefined;
vi.mock('../../../src/core/economy/HaulDispatch.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/core/economy/HaulDispatch.js')>();
  return { ...actual, sealedFragmentIdsOf: () => sealedIds };
});

const { craterRubbleCounts } = await import('../../../scripts/shared/probe-strategies.js');

const crater = { x: 10, z: 10, span: 8 };

function fragment(id: number, x: number, z: number): FragmentData {
  return {
    id, position: { x, y: 0, z }, volume: 0.3, mass: 1000, rockId: 'cruite', oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false, halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1, origin: { x, y: 0, z },
  };
}

function withFragment(state: GameState, id: number, x: number, z: number, st: 'on_ground' | 'stored' | 'in_transit' = 'on_ground'): void {
  state.logistics.fragments.push({ fragment: fragment(id, x, z), state: st, vehicleId: null, warehouseId: null });
}

function withOrder(
  state: GameState, fragmentId: number, type: 'haul_debris' | 'fragment_debris' = 'haul_debris', blockedReason?: string,
): void {
  state.pendingActions.push({
    id: state.nextPendingActionId++, type, ...(blockedReason ? { blockedReason } : {}), requiredSkill: null, requiredVehicleRole: 'debris_hauler',
    targetX: 12, targetZ: 12, targetY: 0, payload: { fragmentId }, targetEmployeeId: null,
  } as unknown as GameState['pendingActions'][number]);
}

describe('craterRubbleCounts', () => {
  let state: GameState;
  beforeEach(() => {
    state = createGame({ seed: 42 });
    sealedIds = undefined;
  });

  it('counts nothing for a clear crater', () => {
    expect(craterRubbleCounts(state, crater)).toEqual({ ordered: 0, orderless: 0, sealed: 0 });
  });

  it('classifies ordered, orderless and sealed fragments in one pass', () => {
    withFragment(state, 1, 12, 12);
    withFragment(state, 2, 13, 13);
    withFragment(state, 3, 14, 14);
    withFragment(state, 4, 15, 15);
    withOrder(state, 1);
    withOrder(state, 4);
    sealedIds = new Set([3]);
    expect(craterRubbleCounts(state, crater)).toEqual({ ordered: 2, orderless: 1, sealed: 1 });
  });

  it('treats an undefined sealed set as empty', () => {
    withFragment(state, 1, 12, 12);
    sealedIds = undefined;
    expect(craterRubbleCounts(state, crater)).toEqual({ ordered: 0, orderless: 1, sealed: 0 });
  });

  it('treats an empty sealed set as empty', () => {
    withFragment(state, 1, 12, 12);
    withOrder(state, 1);
    sealedIds = new Set();
    expect(craterRubbleCounts(state, crater)).toEqual({ ordered: 1, orderless: 0, sealed: 0 });
  });

  it('ignores fragments off the ground', () => {
    withFragment(state, 1, 12, 12, 'stored');
    withFragment(state, 2, 12, 12, 'in_transit');
    expect(craterRubbleCounts(state, crater)).toEqual({ ordered: 0, orderless: 0, sealed: 0 });
  });

  it('ignores fragments outside the crater footprint', () => {
    withFragment(state, 1, 50, 50);
    withFragment(state, 2, 12, 60);
    expect(craterRubbleCounts(state, crater)).toEqual({ ordered: 0, orderless: 0, sealed: 0 });
  });

  it('counts a fragment one tile outside the span as on the footprint', () => {
    withFragment(state, 1, 9, 9);
    withFragment(state, 2, 19, 19);
    expect(craterRubbleCounts(state, crater).orderless).toBe(2);
  });

  it('counts an unordered sealed fragment as sealed only', () => {
    withFragment(state, 1, 12, 12);
    sealedIds = new Set([1]);
    expect(craterRubbleCounts(state, crater)).toEqual({ ordered: 0, orderless: 0, sealed: 1 });
  });
});

describe('craterRubbleCounts blocked orders (#2062)', () => {
  let state: GameState;
  beforeEach(() => {
    state = createGame({ seed: 42 });
    sealedIds = undefined;
  });

  it('a fragment_debris order counts as ordered', () => {
    withFragment(state, 1, 12, 12);
    withOrder(state, 1, 'fragment_debris');
    expect(craterRubbleCounts(state, crater)).toEqual({ ordered: 1, orderless: 0, sealed: 0 });
  });

  it('a blocked haul order counts as sealed, not ordered', () => {
    withFragment(state, 1, 12, 12);
    withOrder(state, 1, 'haul_debris', 'debris_out_of_reach');
    expect(craterRubbleCounts(state, crater)).toEqual({ ordered: 0, orderless: 0, sealed: 1 });
  });

  it('a blocked fragment_debris order counts as sealed', () => {
    withFragment(state, 1, 12, 12);
    withOrder(state, 1, 'fragment_debris', 'target_unreachable');
    expect(craterRubbleCounts(state, crater)).toEqual({ ordered: 0, orderless: 0, sealed: 1 });
  });

  it('an id both sealed and ordered counts once, as sealed', () => {
    withFragment(state, 1, 12, 12);
    withOrder(state, 1);
    sealedIds = new Set([1]);
    expect(craterRubbleCounts(state, crater)).toEqual({ ordered: 0, orderless: 0, sealed: 1 });
  });

  it('an unblocked and a blocked order mix are classified per fragment', () => {
    withFragment(state, 1, 12, 12);
    withFragment(state, 2, 13, 13);
    withOrder(state, 1);
    withOrder(state, 2, 'haul_debris', 'debris_out_of_reach');
    expect(craterRubbleCounts(state, crater)).toEqual({ ordered: 1, orderless: 0, sealed: 1 });
  });

  it('does not mutate the sealed set it was given', () => {
    withFragment(state, 1, 12, 12);
    withOrder(state, 1, 'haul_debris', 'debris_out_of_reach');
    const given = new Set<number>([99]);
    sealedIds = given;
    craterRubbleCounts(state, crater);
    expect([...given]).toEqual([99]);
  });
});
