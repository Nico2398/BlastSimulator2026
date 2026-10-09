// BlastSimulator2026 — Tests for SpoilHeaps.ts (#1530)
//
// Barren fragments (ore fraction at or below SPOIL_BARREN_ORE_FRACTION_THRESHOLD)
// are dumped on a spoil heap instead of a freight warehouse.

import { describe, it, expect } from 'vitest';
import { SPOIL_BARREN_ORE_FRACTION_THRESHOLD } from '../../../src/core/config/balance.js';
import {
  creditSpoilKg, drawSpoilKg, haulDestinationOf, isBarrenFragment, rubbleStockKg, stateRubbleStockKg, totalSpoilKg,
} from '../../../src/core/economy/SpoilHeaps.js';
import { addBlastFragments, createLogisticsState, deliverToSpoilHeap } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { createBuildingState, placeBuilding } from '../../../src/core/entities/Building.js';
import { nearestSite, spoilHeapSites } from '../../../src/core/entities/BuildingWarehouse.js';
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

describe('nearestSite (spoil heap sites)', () => {
  it('returns null when there are no heaps', () => {
    expect(nearestSite([], 5, 5)).toBeNull();
  });

  it('returns the only heap regardless of distance', () => {
    expect(nearestSite([site(3, 90, 90)], 0, 0)?.id).toBe(3);
  });

  it('picks the nearest by squared distance', () => {
    expect(nearestSite([site(1, 30, 0), site(2, 4, 3), site(3, 0, 9)], 0, 0)?.id).toBe(2);
  });

  it('breaks distance ties toward the lowest id regardless of input order', () => {
    expect(nearestSite([site(7, 5, 0), site(2, -5, 0), site(4, 0, 5)], 0, 0)?.id).toBe(2);
    expect(nearestSite([site(2, -5, 0), site(4, 0, 5), site(7, 5, 0)], 0, 0)?.id).toBe(2);
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

type Stock = { type: 'spoil_heap' | 'freight_warehouse'; storedSpoilKg?: number };
const heap = (kg?: number): Stock => (kg === undefined ? { type: 'spoil_heap' } : { type: 'spoil_heap', storedSpoilKg: kg });

describe('rubbleStockKg / stateRubbleStockKg', () => {
  it('adds freight-stored mass to every heap', () => {
    expect(rubbleStockKg(100, [heap(30), heap(20)])).toBe(150);
  });

  it('is just the freight mass with no heaps', () => {
    expect(rubbleStockKg(100, [])).toBe(100);
  });

  it('reads the same total from a state slice', () => {
    const slice = { logistics: { storedMassKg: 100 }, buildings: { buildings: [heap(30), heap(20)] } };
    expect(stateRubbleStockKg(slice)).toBe(150);
  });
});

describe('drawSpoilKg', () => {
  it('draws from heaps in building order, emptying the first before the next', () => {
    const a = heap(40);
    const b = heap(40);
    expect(drawSpoilKg([a, b], 60)).toBe(60);
    expect(a.storedSpoilKg).toBe(0);
    expect(b.storedSpoilKg).toBe(20);
  });

  it('returns the actual amount removed when asked for more than the heaps hold', () => {
    const a = heap(10);
    const b = heap(5);
    expect(drawSpoilKg([a, b], 100)).toBe(15);
    expect(a.storedSpoilKg).toBe(0);
    expect(b.storedSpoilKg).toBe(0);
  });

  it('skips non-heap buildings even if they carry the field', () => {
    const warehouse: Stock = { type: 'freight_warehouse', storedSpoilKg: 99 };
    const h = heap(10);
    expect(drawSpoilKg([warehouse, h], 50)).toBe(10);
    expect(warehouse.storedSpoilKg).toBe(99);
  });

  it('treats a heap without stock as empty', () => {
    const empty = heap();
    expect(drawSpoilKg([empty], 5)).toBe(0);
    expect(empty.storedSpoilKg).toBeUndefined();
  });

  it('removes nothing for an amount of 0 or less', () => {
    const h = heap(10);
    expect(drawSpoilKg([h], 0)).toBe(0);
    expect(drawSpoilKg([h], -5)).toBe(0);
    expect(h.storedSpoilKg).toBe(10);
  });
});

describe('creditSpoilKg', () => {
  it('adds to existing stock', () => {
    const h = heap(10);
    creditSpoilKg(h, 5);
    expect(h.storedSpoilKg).toBe(15);
  });

  it('starts an unset heap from 0', () => {
    const h = heap();
    creditSpoilKg(h, 5);
    expect(h.storedSpoilKg).toBe(5);
  });
});

describe('deliverToSpoilHeap', () => {
  const fragment = (id: number, mass: number, oreDensities: Record<string, number>): FragmentData => ({
    id, position: { x: 0, y: 0, z: 0 }, volume: 0.3, mass, rockId: 'cruite', oreDensities,
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, shapeSeed: 1, origin: { x: 0, y: 0, z: 0 },
  });
  const inTransit = (id: number, mass: number, oreDensities: Record<string, number>, warehouseId: number | null) => {
    const l = createLogisticsState();
    addBlastFragments(l, [fragment(id, mass, oreDensities)]);
    Object.assign(l.fragments[0]!, { state: 'in_transit', vehicleId: 'v1', warehouseId });
    return l;
  };

  it('returns null for an ore-bearing fragment and leaves it in logistics', () => {
    const l = inTransit(1, 500, { blingite: 0.5 }, 1);
    expect(deliverToSpoilHeap(l, 1, [site(1, 0, 0)], 0, 0)).toBeNull();
    expect(l.fragments).toHaveLength(1);
  });

  it('returns null without mutating when no heap exists', () => {
    const l = inTransit(1, 500, {}, null);
    expect(deliverToSpoilHeap(l, 1, [], 0, 0)).toBeNull();
    expect(l.fragments).toHaveLength(1);
    expect(l.fragments[0]!.state).toBe('in_transit');
  });

  it('dumps on the reserved heap and removes the fragment from logistics', () => {
    const l = inTransit(1, 500, {}, 2);
    expect(deliverToSpoilHeap(l, 1, [site(1, 0, 0), site(2, 50, 50)], 0, 0)).toEqual({ heapId: 2, massKg: 500 });
    expect(l.fragments).toHaveLength(0);
    expect(l.storedMassKg).toBe(0);
  });

  it('falls back to the nearest heap when the reserved one is gone', () => {
    const l = inTransit(1, 500, {}, 99);
    expect(deliverToSpoilHeap(l, 1, [site(1, 40, 40), site(2, 3, 4)], 0, 0)).toEqual({ heapId: 2, massKg: 500 });
    expect(l.fragments).toHaveLength(0);
  });
});
