// BlastSimulator2026 — Tests for SpoilHeaps.ts (#1530)
//
// Barren fragments (ore fraction at or below SPOIL_BARREN_ORE_FRACTION_THRESHOLD)
// are dumped on a spoil heap instead of a freight warehouse.

import { describe, it, expect } from 'vitest';
import { SPOIL_BARREN_ORE_FRACTION_THRESHOLD, SPOIL_HEAP_CAPACITY_KG, BARREN_OVERFLOW_STORED_SHARE } from '../../../src/core/config/balance.js';
import {
  creditSpoilHeaps, creditSpoilKg, spoilHeapRoomKg, totalSpoilRoomKg, drawSpoilKg, barrenStoredMassKg, haulDestinationOf, isBarrenFragment, rubbleStockKg, stateRubbleStockKg, totalSpoilKg, barrenOverflowKg, stateBarrenOverflowKg,
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

  it('a scaled fragment is barren only at or below threshold * scale (#1932)', () => {
    const scale = 0.2;
    const edge = SPOIL_BARREN_ORE_FRACTION_THRESHOLD * scale;
    expect(isBarrenFragment({ blingite: edge }, scale)).toBe(true);
    expect(isBarrenFragment({ blingite: edge * 1.5 }, scale)).toBe(false);
  });

  it('a fragment scaled by s at gradeScale s classifies like the unscaled one at scale 1 (#1932)', () => {
    const scale = 0.2;
    for (const d of [0.005, 0.02, 0.03, 0.5]) {
      expect(isBarrenFragment({ blingite: d * scale }, scale)).toBe(isBarrenFragment({ blingite: d }, 1));
    }
  });

  it('scale 1 behaves as today (#1932)', () => {
    expect(isBarrenFragment({ blingite: SPOIL_BARREN_ORE_FRACTION_THRESHOLD }, 1)).toBe(true);
    expect(isBarrenFragment({ blingite: SPOIL_BARREN_ORE_FRACTION_THRESHOLD + 0.001 }, 1)).toBe(false);
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

  it('lists an active spoil heap with the finite heap capacity (#1892)', () => {
    const sites = spoilHeapSites(stateWithHeap());
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ x: 10, z: 12 });
    expect(sites[0]!.capacityKg).toBe(SPOIL_HEAP_CAPACITY_KG);
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

describe('rubble stock at a scaled grade (#1932)', () => {
  const SCALE = 0.2;
  // Proportionally scaled densities classify at SCALE exactly as the unscaled ones at 1.
  const fragments = () => [0.005, 0.02, 0.03, 0.5].map((d, i) => frag(100 * (i + 1), { blingite: d * SCALE }));
  const unscaled = () => [0.005, 0.02, 0.03, 0.5].map((d, i) => frag(100 * (i + 1), { blingite: d }));

  it('rubbleStockKg matches the unscaled stock at scale 1', () => {
    expect(rubbleStockKg(fragments(), [heap(30)], SCALE)).toBe(rubbleStockKg(unscaled(), [heap(30)], 1));
    expect(rubbleStockKg(fragments(), [heap(30)], SCALE)).toBe(330);
  });

  it('stateRubbleStockKg reads world.oreGradeScale', () => {
    const slice = (world: { oreGradeScale?: number }) => ({
      logistics: { fragments: fragments() }, buildings: { buildings: [heap(30)] }, world,
    });
    expect(stateRubbleStockKg(slice({ oreGradeScale: SCALE }))).toBe(330);
    // Unset scale reads at 1, where the scaled densities all fall under the 0.02 cut except the last.
    expect(stateRubbleStockKg(slice({}))).toBe(630);
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

  it('returns null without mutating when the only heap is full', () => {
    const l = inTransit(1, 500, {}, null);
    const full: WarehouseSite = { id: 1, x: 0, z: 0, capacityKg: 100 };
    expect(deliverToSpoilHeap(l, 1, [full], 0, 0)).toBeNull();
    expect(l.fragments).toHaveLength(1);
    expect(l.fragments[0]!.state).toBe('in_transit');
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

describe('creditSpoilHeaps (#1690 coverage, ported from creditFirstSpoilHeap)', () => {
  const other = () => ({ type: 'freight_warehouse' as const, tier: 1 }) as Pick<Building, 'type' | 'tier' | 'storedSpoilKg'>;

  it('credits the first heap in building order and returns true', () => {
    const [a, b] = [pile(10), pile(20)];
    expect(creditSpoilHeaps([other(), a, b], 500)).toBe(true);
    expect(a.storedSpoilKg).toBe(510);
    expect(b.storedSpoilKg).toBe(20);
  });

  it('treats an unset storedSpoilKg as zero', () => {
    const a = pile(undefined);
    expect(creditSpoilHeaps([a], 75)).toBe(true);
    expect(a.storedSpoilKg).toBe(75);
  });

  it('crediting zero kg succeeds and leaves the heap unchanged (boundary)', () => {
    const a = pile(30);
    expect(creditSpoilHeaps([a], 0)).toBe(true);
    expect(a.storedSpoilKg).toBe(30);
  });

  it('returns false and credits nothing when there is no heap', () => {
    const w = other();
    expect(creditSpoilHeaps([w], 500)).toBe(false);
    expect(w.storedSpoilKg).toBeUndefined();
    expect(creditSpoilHeaps([], 500)).toBe(false);
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

describe('barrenOverflowKg / stateBarrenOverflowKg (#2018)', () => {
  const ore = { blingite: 0.5 };
  const full = () => [pile(SPOIL_HEAP_CAPACITY_KG)];

  it('share constant is one half', () => {
    expect(BARREN_OVERFLOW_STORED_SHARE).toBe(0.5);
  });

  it('returns the barren kg when barren is most of storage and every heap is full', () => {
    expect(barrenOverflowKg([frag(48_000), frag(2_000, ore)], 50_000, full())).toBe(48_000);
  });

  it('returns the barren kg with no heap at all', () => {
    expect(barrenOverflowKg([frag(30_000), frag(10_000, ore)], 40_000, [])).toBe(30_000);
  });

  it('counts exactly half as overflow (boundary, inclusive)', () => {
    expect(barrenOverflowKg([frag(25_000), frag(25_000, ore)], 50_000, full())).toBe(25_000);
  });

  it('is 0 just under half', () => {
    expect(barrenOverflowKg([frag(24_999), frag(25_001, ore)], 50_000, full())).toBe(0);
  });

  it('is 0 when a heap still has room', () => {
    expect(barrenOverflowKg([frag(48_000), frag(2_000, ore)], 50_000, [pile(SPOIL_HEAP_CAPACITY_KG - 1), pile(SPOIL_HEAP_CAPACITY_KG)])).toBe(0);
  });

  it('is 0 when nothing is stored', () => {
    expect(barrenOverflowKg([], 0, full())).toBe(0);
    expect(barrenOverflowKg([frag(100)], 0, full())).toBe(0);
  });

  it('is 0 when the warehouse is full of ore', () => {
    expect(barrenOverflowKg([frag(1_000), frag(49_000, ore)], 50_000, full())).toBe(0);
  });

  it('ignores fragments that are not stored', () => {
    expect(barrenOverflowKg([frag(40_000, {}, 'on_ground'), frag(5_000, {}, 'in_transit'), frag(10_000, ore)], 10_000, full())).toBe(0);
    expect(barrenOverflowKg([frag(40_000, {}, 'on_ground'), frag(6_000), frag(4_000, ore)], 10_000, full())).toBe(6_000);
  });

  it('reads the grade scale: a fragment barren at scale 1 is ore at scale 0.5', () => {
    const scaled = frag(10_000, { blingite: 0.015 });
    expect(barrenOverflowKg([scaled], 10_000, full())).toBe(10_000);
    expect(barrenOverflowKg([scaled], 10_000, full(), 1)).toBe(10_000);
    expect(barrenOverflowKg([scaled], 10_000, full(), 0.5)).toBe(0);
  });

  it('state variant reads logistics, buildings and the world grade scale', () => {
    const state = {
      logistics: { fragments: [frag(48_000), frag(2_000, ore)], storedMassKg: 50_000 },
      buildings: { buildings: full() },
      world: null,
    };
    expect(stateBarrenOverflowKg(state)).toBe(48_000);
    expect(stateBarrenOverflowKg({ ...state, buildings: { buildings: [pile(0)] } })).toBe(0);
    const scaled = { ...state, logistics: { fragments: [frag(10_000, { blingite: 0.015 })], storedMassKg: 10_000 } };
    expect(stateBarrenOverflowKg(scaled)).toBe(10_000);
    expect(stateBarrenOverflowKg({ ...scaled, world: { oreGradeScale: 0.5 } })).toBe(0);
  });
});
