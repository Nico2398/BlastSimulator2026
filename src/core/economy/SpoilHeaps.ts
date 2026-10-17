// BlastSimulator2026 — Spoil heaps (#1530)
// Barren fragments are dumped on a spoil heap instead of a freight warehouse.

import type { Building } from '../entities/Building.js';
import { SPOIL_BARREN_ORE_FRACTION_THRESHOLD } from '../config/balance.js';

/** Where a hauled fragment is delivered. */
export type HaulDestination = 'warehouse' | 'spoil_heap';

/**
 * Whether a fragment's ore densities make it barren: summed density at or below
 * SPOIL_BARREN_ORE_FRACTION_THRESHOLD (empty = barren). Decides haul destination
 * and the rubble-draw order in Logistics.consumeStoredOre.
 */
export function isBarrenFragment(oreDensities: Readonly<Record<string, number>>): boolean {
  let total = 0;
  for (const d of Object.values(oreDensities)) total += d;
  return total <= SPOIL_BARREN_ORE_FRACTION_THRESHOLD;
}

/** Destination for a fragment, by its ore densities. */
export function haulDestinationOf(fragment: { oreDensities: Readonly<Record<string, number>> }): HaulDestination {
  return isBarrenFragment(fragment.oreDensities) ? 'spoil_heap' : 'warehouse';
}

/** Total barren rock (kg) stored across the given buildings' spoil heaps. */
export function totalSpoilKg(buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[]): number {
  let total = 0;
  for (const b of buildings) {
    if (b.type === 'spoil_heap') total += b.storedSpoilKg ?? 0;
  }
  return total;
}

/** Fragment shape needed to tell stored barren rock from stored ore. */
export interface StoredFragmentLike {
  state: string;
  fragment: { mass: number; oreDensities: Readonly<Record<string, number>> };
}

/** Mass (kg) of stored fragments that are barren (state 'stored' and isBarrenFragment). */
export function barrenStoredMassKg(fragments: readonly StoredFragmentLike[]): number {
  let total = 0;
  for (const f of fragments) {
    if (f.state === 'stored' && isBarrenFragment(f.fragment.oreDensities)) total += f.fragment.mass;
  }
  return total;
}

/** Barren rock a rubble_disposal contract can draw on: stored barren fragments plus every heap's rock. Ore-bearing stock is never rubble (#1871). */
export function rubbleStockKg(fragments: readonly StoredFragmentLike[], buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[]): number {
  return barrenStoredMassKg(fragments) + totalSpoilKg(buildings);
}

/** rubbleStockKg for any state slice carrying logistics and buildings (GameState fits). */
export function stateRubbleStockKg(
  state: { logistics: { fragments: readonly StoredFragmentLike[] }; buildings: { buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[] } },
): number {
  return rubbleStockKg(state.logistics.fragments, state.buildings.buildings);
}

/** Remove up to `amountKg` of barren rock from the heaps, in building order; returns the kg removed. */
export function drawSpoilKg(buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[], amountKg: number): number {
  let remaining = amountKg;
  for (const b of buildings) {
    if (remaining <= 0) break;
    if (b.type !== 'spoil_heap') continue;
    const take = Math.min(remaining, b.storedSpoilKg ?? 0);
    if (take <= 0) continue;
    b.storedSpoilKg = (b.storedSpoilKg ?? 0) - take;
    remaining -= take;
  }
  return amountKg - remaining;
}

/** Add `amountKg` of barren rock to a heap building (the counterpart of drawSpoilKg). */
export function creditSpoilKg(heap: Pick<Building, 'storedSpoilKg'>, amountKg: number): void {
  heap.storedSpoilKg = (heap.storedSpoilKg ?? 0) + amountKg;
}

/**
 * Credit `amountKg` of barren rock to the first spoil_heap building (building order).
 * Returns false, crediting nothing, when no heap exists.
 */
export function creditFirstSpoilHeap(buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[], amountKg: number): boolean {
  const heap = buildings.find(b => b.type === 'spoil_heap');
  if (!heap) return false;
  creditSpoilKg(heap, amountKg);
  return true;
}
