// BlastSimulator2026 — Tests for SpoilHeaps.ts (#1530)
//
// Barren fragments (ore fraction at or below SPOIL_BARREN_ORE_FRACTION_THRESHOLD)
// are dumped on a spoil heap instead of a freight warehouse.

import { describe, it, expect } from 'vitest';
import { SPOIL_BARREN_ORE_FRACTION_THRESHOLD, SPOIL_HEAP_CAPACITY_KG } from '../../../src/core/config/balance.js';
import {
  creditFirstSpoilHeap, creditSpoilHeaps, creditSpoilKg, spoilHeapRoomKg, totalSpoilRoomKg, drawSpoilKg, barrenStoredMassKg, haulDestinationOf, isBarrenFragment, rubbleStockKg, stateRubbleStockKg, totalSpoilKg,
} from '../../../src/core/economy/SpoilHeaps.js';
import { addBlastFragments, createLogisticsState, deliverToSpoilHeap } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import type { Building } from '../../../src/core/entities/Building.js';
import { BUILDING_DEFS } from '../../../src/core/entities/BuildingDefs.js';
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

const frag = (mass: number, oreDensities: Record<string, number> = {}, state = 'stored') => ({ state, fragment: { mass, oreDensities } });

describe('barrenStoredMassKg (#1871)', () => {
  it('is 0 for no fragments', () => {
    expect(barrenStoredMassKg([])).toBe(0);
  });

  it('sums the mass of stored barren fragments', () => {
    expect(barrenStoredMassKg([frag(100), frag(250, { blingite: 0.01 })])).toBe(350);
  });

  it('excludes ore-bearing stored fragments', () => {
    expect(barrenStoredMassKg([frag(100), frag(500, { blingite: 0.5 })])).toBe(100);
  });

  it('is 0 when every stored fragment bears ore', () => {
    expect(barrenStoredMassKg([frag(500, { blingite: 0.5 }), frag(300, { cruite: 0.2 })])).toBe(0);
  });

  it('excludes barren fragments that are not in state stored', () => {
    expect(barrenStoredMassKg([
      frag(100, {}, 'on_ground'), frag(200, {}, 'in_transit'), frag(300, {}, 'sold'), frag(40),
    ])).toBe(40);
  });

  it('counts a fragment exactly at the threshold as barren', () => {
    expect(barrenStoredMassKg([frag(70, { blingite: SPOIL_BARREN_ORE_FRACTION_THRESHOLD })])).toBe(70);
  });

  it('does not count a fragment just above the threshold', () => {
    expect(barrenStoredMassKg([frag(70, { blingite: SPOIL_BARREN_ORE_FRACTION_THRESHOLD + 0.001 })])).toBe(0);
  });
});

describe('rubbleStockKg / stateRubbleStockKg', () => {
  it('adds stored barren mass to every heap', () => {
    expect(rubbleStockKg([frag(100)], [heap(30), heap(20)])).toBe(150);
  });

  it('is just the barren stored mass with no heaps', () => {
    expect(rubbleStockKg([frag(100)], [])).toBe(100);
  });

  it('is just the heaps with no fragments', () => {
    expect(rubbleStockKg([], [heap(30), heap(20)])).toBe(50);
  });

  it('excludes ore-bearing stored mass (#1871)', () => {
    expect(rubbleStockKg([frag(100), frag(900, { blingite: 0.6 })], [heap(30)])).toBe(130);
  });

  it('is 0 when only ore-bearing mass is stored and no heap holds spoil', () => {
    expect(rubbleStockKg([frag(900, { blingite: 0.6 })], [heap(0)])).toBe(0);
  });

  it('reads the same total from a state slice, ore excluded', () => {
    const slice = {
      logistics: { fragments: [frag(100), frag(900, { blingite: 0.6 })] },
      buildings: { buildings: [heap(30), heap(20)] },
    };
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

describe('creditFirstSpoilHeap (#1690)', () => {
  const heap = (kg?: number): Pick<Building, 'type' | 'storedSpoilKg'> =>
    kg === undefined ? { type: 'spoil_heap' } : { type: 'spoil_heap', storedSpoilKg: kg };
  const other = () => ({ type: 'freight_warehouse' as const }) as Pick<Building, 'type' | 'storedSpoilKg'>;

  it('credits the first heap in building order and returns true', () => {
    const [a, b] = [heap(10), heap(20)];
    expect(creditFirstSpoilHeap([other(), a, b], 500)).toBe(true);
    expect(a.storedSpoilKg).toBe(510);
    expect(b.storedSpoilKg).toBe(20);
  });

  it('treats an unset storedSpoilKg as zero', () => {
    const a = heap(undefined);
    expect(creditFirstSpoilHeap([a], 75)).toBe(true);
    expect(a.storedSpoilKg).toBe(75);
  });

  it('crediting zero kg succeeds and leaves the heap unchanged (boundary)', () => {
    const a = heap(30);
    expect(creditFirstSpoilHeap([a], 0)).toBe(true);
    expect(a.storedSpoilKg).toBe(30);
  });

  it('returns false and credits nothing when there is no heap', () => {
    const w = other();
    expect(creditFirstSpoilHeap([w], 500)).toBe(false);
    expect(w.storedSpoilKg).toBeUndefined();
    expect(creditFirstSpoilHeap([], 500)).toBe(false);
  });
});

// ── #1892: finite spoil heaps ───────────────────────────────────────────────

type Pile = { type: 'spoil_heap' | 'freight_warehouse'; tier: 1 | 2 | 3; storedSpoilKg?: number };
const pile = (kg?: number): Pile => (kg === undefined ? { type: 'spoil_heap', tier: 1 } : { type: 'spoil_heap', tier: 1, storedSpoilKg: kg });

describe('spoil heap capacity (#1892)', () => {
  it('SPOIL_HEAP_CAPACITY_KG is the spoil heap tier 1 capacity in BuildingDefs', () => {
    expect(BUILDING_DEFS.spoil_heap[1].capacity).toBe(SPOIL_HEAP_CAPACITY_KG);
  });
});

describe('spoilHeapRoomKg (#1892)', () => {
  it('an empty heap has its whole capacity free', () => {
    expect(spoilHeapRoomKg(pile())).toBe(SPOIL_HEAP_CAPACITY_KG);
  });

  it('room is capacity minus stored rock', () => {
    expect(spoilHeapRoomKg(pile(12_000))).toBe(SPOIL_HEAP_CAPACITY_KG - 12_000);
  });

  it('a full heap has no room (boundary)', () => {
    expect(spoilHeapRoomKg(pile(SPOIL_HEAP_CAPACITY_KG))).toBe(0);
  });

  it('an overfull heap clamps to 0, never negative', () => {
    expect(spoilHeapRoomKg(pile(SPOIL_HEAP_CAPACITY_KG + 5_000))).toBe(0);
  });

  it('a non-heap building has no room', () => {
    expect(spoilHeapRoomKg({ type: 'freight_warehouse', tier: 1 })).toBe(0);
  });
});

describe('totalSpoilRoomKg (#1892)', () => {
  it('is 0 for no buildings', () => {
    expect(totalSpoilRoomKg([])).toBe(0);
  });

  it('sums the room over every heap', () => {
    expect(totalSpoilRoomKg([pile(10_000), pile(SPOIL_HEAP_CAPACITY_KG)])).toBe(2 * SPOIL_HEAP_CAPACITY_KG - 10_000 - SPOIL_HEAP_CAPACITY_KG);
  });

  it('ignores non-heap buildings', () => {
    expect(totalSpoilRoomKg([{ type: 'freight_warehouse', tier: 1 }, pile(0)])).toBe(SPOIL_HEAP_CAPACITY_KG);
  });

  it('is 0 when every heap is full', () => {
    expect(totalSpoilRoomKg([pile(SPOIL_HEAP_CAPACITY_KG), pile(SPOIL_HEAP_CAPACITY_KG)])).toBe(0);
  });
});

describe('creditSpoilHeaps (#1892)', () => {
  it('credits a heap with room and returns true', () => {
    const heaps = [pile(0)];
    expect(creditSpoilHeaps(heaps, 1_000)).toBe(true);
    expect(heaps[0]!.storedSpoilKg).toBe(1_000);
  });

  it('fills exactly to capacity (boundary)', () => {
    const heaps = [pile(SPOIL_HEAP_CAPACITY_KG - 400)];
    expect(creditSpoilHeaps(heaps, 400)).toBe(true);
    expect(heaps[0]!.storedSpoilKg).toBe(SPOIL_HEAP_CAPACITY_KG);
  });

  it('refuses, crediting nothing, when no heap has room for the amount', () => {
    const heaps = [pile(SPOIL_HEAP_CAPACITY_KG - 399)];
    expect(creditSpoilHeaps(heaps, 400)).toBe(false);
    expect(heaps[0]!.storedSpoilKg).toBe(SPOIL_HEAP_CAPACITY_KG - 399);
  });

  it('skips a full heap and credits the next heap with room', () => {
    const heaps = [pile(SPOIL_HEAP_CAPACITY_KG), pile(0)];
    expect(creditSpoilHeaps(heaps, 700)).toBe(true);
    expect(heaps[0]!.storedSpoilKg).toBe(SPOIL_HEAP_CAPACITY_KG);
    expect(heaps[1]!.storedSpoilKg).toBe(700);
  });

  it('credits the first heap with room in building order', () => {
    const heaps = [pile(10), pile(20)];
    creditSpoilHeaps(heaps, 5);
    expect(heaps[0]!.storedSpoilKg).toBe(15);
    expect(heaps[1]!.storedSpoilKg).toBe(20);
  });

  it('returns false with no heap at all', () => {
    expect(creditSpoilHeaps([{ type: 'freight_warehouse', tier: 1 }], 1)).toBe(false);
    expect(creditSpoilHeaps([], 1)).toBe(false);
  });
});

describe('drawSpoilKg frees room (#1892)', () => {
  it('a rubble draw from a full heap gives its room back', () => {
    const heaps = [pile(SPOIL_HEAP_CAPACITY_KG)];
    expect(totalSpoilRoomKg(heaps)).toBe(0);
    drawSpoilKg(heaps, 8_000);
    expect(totalSpoilRoomKg(heaps)).toBe(8_000);
    expect(creditSpoilHeaps(heaps, 8_000)).toBe(true);
  });
});
