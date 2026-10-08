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

/** Rubble a rubble_disposal contract can draw on: freight-stored mass plus every heap's barren rock. */
export function rubbleStockKg(storedMassKg: number, buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[]): number {
  return storedMassKg + totalSpoilKg(buildings);
}

/** rubbleStockKg for any state slice carrying logistics and buildings (GameState fits). */
export function stateRubbleStockKg(
  state: { logistics: { storedMassKg: number }; buildings: { buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[] } },
): number {
  return rubbleStockKg(state.logistics.storedMassKg, state.buildings.buildings);
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
