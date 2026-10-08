// BlastSimulator2026 — Spoil heaps (#1530)
// Barren fragments are dumped on a spoil heap instead of a freight warehouse.

import type { Building } from '../entities/Building.js';
import type { WarehouseSite } from '../entities/BuildingWarehouse.js';

/** Where a hauled fragment is delivered. */
export type HaulDestination = 'warehouse' | 'spoil_heap';

/** Whether a fragment's ore densities make it barren (below the ore-fraction threshold). */
export function isBarrenFragment(_oreDensities: Readonly<Record<string, number>>): boolean {
  // TODO: implement
  return false;
}

/** Destination for a fragment, by its ore densities. */
export function haulDestinationOf(_fragment: { oreDensities: Readonly<Record<string, number>> }): HaulDestination {
  // TODO: implement
  return 'warehouse';
}

/** Nearest site by squared distance to (x, z); ties go to the lowest id; null when none. */
export function pickSpoilHeap(_sites: readonly WarehouseSite[], _x: number, _z: number): WarehouseSite | null {
  // TODO: implement
  return null;
}

/** Total barren rock (kg) stored across the given buildings' spoil heaps. */
export function totalSpoilKg(_buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[]): number {
  // TODO: implement
  return 0;
}
