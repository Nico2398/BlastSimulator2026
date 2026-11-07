// BlastSimulator2026 — Warehouse operations
// Freight Warehouse capacity checks.

import type { BuildingState } from './Building.js';
import { getBuildingDef, getStorageCapacity, isOperating, spoilHeapRoomKg } from './Building.js';

// ── Freight Warehouse ────────────────────────────────────────────────────────

/**
 * Check whether freight warehouses can accommodate additional material.
 * @param currentStoredKg - Material already stored in logistics
 * @param additionalKg - New material to accept
 */
export function freightWarehouseHasRoom(
  state: BuildingState,
  currentStoredKg: number,
  additionalKg: number,
): boolean {
  return currentStoredKg + additionalKg <= getStorageCapacity(state);
}

/** A placed, active freight warehouse as seen by logistics: where it is and how much it holds. */
export interface WarehouseSite {
  id: number;
  x: number;
  z: number;
  capacityKg: number;
}

/** Active freight warehouses as logistics sites. */
export function freightWarehouseSites(state: BuildingState): WarehouseSite[] {
  const sites: WarehouseSite[] = [];
  for (const b of state.buildings) {
    if (isOperating(b) && b.type === 'freight_warehouse') {
      sites.push({ id: b.id, x: b.x, z: b.z, capacityKg: getBuildingDef(b.type, b.tier).capacity });
    }
  }
  return sites;
}

/**
 * Nearest site to (x, z) by squared distance among those `accepts` (default all);
 * ties go to the lowest id; null when none qualifies.
 */
export function nearestSite(
  sites: readonly WarehouseSite[],
  x: number,
  z: number,
  accepts: (site: WarehouseSite) => boolean = () => true,
): WarehouseSite | null {
  let best: WarehouseSite | null = null;
  let bestDist = Infinity;
  for (const site of sites) {
    if (!accepts(site)) continue;
    const dist = (site.x - x) ** 2 + (site.z - z) ** 2;
    if (dist < bestDist || (dist === bestDist && best !== null && site.id < best.id)) {
      best = site;
      bestDist = dist;
    }
  }
  return best;
}

/** Active spoil heaps as logistics sites (#1530); capacityKg is the room left (#1892). */
export function spoilHeapSites(state: BuildingState): WarehouseSite[] {
  const sites: WarehouseSite[] = [];
  for (const b of state.buildings) {
    if (isOperating(b) && b.type === 'spoil_heap') {
      sites.push({ id: b.id, x: b.x, z: b.z, capacityKg: spoilHeapRoomKg(b) });
    }
  }
  return sites;
}
