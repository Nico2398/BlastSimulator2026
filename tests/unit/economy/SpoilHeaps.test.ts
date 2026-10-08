// BlastSimulator2026 — Tests for SpoilHeaps.ts (#1530)
//
// Barren fragments (ore fraction at or below SPOIL_BARREN_ORE_FRACTION_THRESHOLD)
// are dumped on a spoil heap instead of a freight warehouse.
//
// Red phase: the SpoilHeaps.ts / spoilHeapSites stubs return neutral values.

import { describe, it, expect } from 'vitest';
import { SPOIL_BARREN_ORE_FRACTION_THRESHOLD } from '../../../src/core/config/balance.js';
import { haulDestinationOf, isBarrenFragment, pickSpoilHeap, totalSpoilKg } from '../../../src/core/economy/SpoilHeaps.js';
import { createBuildingState, placeBuilding } from '../../../src/core/entities/Building.js';
import { spoilHeapSites } from '../../../src/core/entities/BuildingWarehouse.js';
import type { WarehouseSite } from '../../../src/core/entities/BuildingWarehouse.js';

const site = (id: number, x: number, z: number): WarehouseSite => ({ id, x, z, capacityKg: 1e12 });

describe('isBarrenFragment', () => {
  it('threshold constant is 0.02', () => {
    expect(SPOIL_BARREN_ORE_FRACTION_THRESHOLD).toBe(0.02);
  });

  it('an empty density map is barren', () => {
    expect(isBarrenFragment({})).toBe(true);
  });

  it('a fragment rich in ore is not barren', () => {
    expect(isBarrenFragment({ blingite: 0.5 })).toBe(false);
  });

  it('exactly the threshold is barren (boundary, inclusive)', () => {
    expect(isBarrenFragment({ blingite: SPOIL_BARREN_ORE_FRACTION_THRESHOLD })).toBe(true);
  });

  it('just above the threshold is not barren', () => {
    expect(isBarrenFragment({ blingite: SPOIL_BARREN_ORE_FRACTION_THRESHOLD + 0.001 })).toBe(false);
  });

  it('sums densities across ores: two traces that together exceed the threshold are not barren', () => {
    expect(isBarrenFragment({ blingite: 0.015, cruite: 0.015 })).toBe(false);
  });

  it('sums densities across ores: two traces that stay at or under the threshold are barren', () => {
    expect(isBarrenFragment({ blingite: 0.01, cruite: 0.01 })).toBe(true);
  });

  it('zero densities are barren', () => {
    expect(isBarrenFragment({ blingite: 0 })).toBe(true);
  });
});

describe('haulDestinationOf', () => {
  it('barren goes to the spoil heap', () => {
    expect(haulDestinationOf({ oreDensities: {} })).toBe('spoil_heap');
  });

  it('ore-bearing goes to the warehouse', () => {
    expect(haulDestinationOf({ oreDensities: { blingite: 0.3 } })).toBe('warehouse');
  });

  it('threshold boundary: at threshold spoil_heap, above it warehouse', () => {
    expect(haulDestinationOf({ oreDensities: { blingite: 0.02 } })).toBe('spoil_heap');
    expect(haulDestinationOf({ oreDensities: { blingite: 0.03 } })).toBe('warehouse');
  });
});

describe('pickSpoilHeap', () => {
  it('returns null when there are no heaps', () => {
    expect(pickSpoilHeap([], 5, 5)).toBeNull();
  });

  it('returns the only heap regardless of distance', () => {
    expect(pickSpoilHeap([site(3, 90, 90)], 0, 0)?.id).toBe(3);
  });

  it('picks the nearest by squared distance', () => {
    expect(pickSpoilHeap([site(1, 30, 0), site(2, 4, 3), site(3, 0, 9)], 0, 0)?.id).toBe(2);
  });

  it('breaks distance ties toward the lowest id regardless of input order', () => {
    expect(pickSpoilHeap([site(7, 5, 0), site(2, -5, 0), site(4, 0, 5)], 0, 0)?.id).toBe(2);
    expect(pickSpoilHeap([site(2, -5, 0), site(4, 0, 5), site(7, 5, 0)], 0, 0)?.id).toBe(2);
  });
});

describe('totalSpoilKg', () => {
  it('is 0 for no buildings', () => {
    expect(totalSpoilKg([])).toBe(0);
  });

  it('sums storedSpoilKg over spoil heaps, undefined counting as 0', () => {
    expect(totalSpoilKg([
      { type: 'spoil_heap', storedSpoilKg: 300 },
      { type: 'spoil_heap', storedSpoilKg: 200 },
      { type: 'spoil_heap' },
    ])).toBe(500);
  });

  it('ignores other building types even if they carry the field', () => {
    expect(totalSpoilKg([
      { type: 'freight_warehouse', storedSpoilKg: 999 },
      { type: 'spoil_heap', storedSpoilKg: 40 },
    ])).toBe(40);
  });
});

describe('spoilHeapSites', () => {
  function stateWithHeap() {
    const state = createBuildingState();
    const r = placeBuilding(state, 'spoil_heap', 10, 12, 64, 64);
    if (!r.success) throw new Error(`setup: ${r.error}`);
    return state;
  }

  it('lists an active spoil heap with effectively unbounded capacity', () => {
    const sites = spoilHeapSites(stateWithHeap());
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ x: 10, z: 12 });
    expect(sites[0]!.capacityKg).toBeGreaterThan(1e9);
  });

  it('omits inactive heaps', () => {
    const state = stateWithHeap();
    state.buildings[0]!.active = false;
    expect(spoilHeapSites(state)).toEqual([]);
  });

  it('ignores freight warehouses', () => {
    const state = createBuildingState();
    placeBuilding(state, 'freight_warehouse', 20, 20, 64, 64);
    expect(spoilHeapSites(state)).toEqual([]);
  });
});
