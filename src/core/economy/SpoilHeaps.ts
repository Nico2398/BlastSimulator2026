// BlastSimulator2026 — Spoil heaps (#1530)
// Barren fragments are dumped on a spoil heap instead of a freight warehouse.

import type { Building } from '../entities/Building.js';
import type { WarehouseSite } from '../entities/BuildingWarehouse.js';
import { SPOIL_BARREN_ORE_FRACTION_THRESHOLD } from '../config/balance.js';

/** Where a hauled fragment is delivered. */
export type HaulDestination = 'warehouse' | 'spoil_heap';

/** Whether a fragment's ore densities make it barren (summed density at or below the threshold; empty = barren). */
export function isBarrenFragment(oreDensities: Readonly<Record<string, number>>): boolean {
  let total = 0;
  for (const d of Object.values(oreDensities)) total += d;
  return total <= SPOIL_BARREN_ORE_FRACTION_THRESHOLD;
}

/** Destination for a fragment, by its ore densities. */
export function haulDestinationOf(fragment: { oreDensities: Readonly<Record<string, number>> }): HaulDestination {
  return isBarrenFragment(fragment.oreDensities) ? 'spoil_heap' : 'warehouse';
}

/** Nearest site by squared distance to (x, z); ties go to the lowest id; null when none. */
export function pickSpoilHeap(sites: readonly WarehouseSite[], x: number, z: number): WarehouseSite | null {
  let best: WarehouseSite | null = null;
  let bestDist = Infinity;
  for (const site of sites) {
    const dist = (site.x - x) ** 2 + (site.z - z) ** 2;
    if (dist < bestDist || (dist === bestDist && best !== null && site.id < best.id)) {
      best = site;
      bestDist = dist;
    }
  }
  return best;
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
