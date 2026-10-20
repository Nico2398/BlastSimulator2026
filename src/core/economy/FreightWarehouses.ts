// BlastSimulator2026 — Per-warehouse freight storage behind the shared pool (#1372)

import { nearestSite, type WarehouseSite } from '../entities/BuildingWarehouse.js';
import type { LogisticsState, TrackedFragment } from './Logistics.js';
import { sumOreMass, clampCollectedOre, decrementCollectedOre } from '../mining/BlastOreReport.js';

export type { WarehouseSite };

/** Ore and mass lost when a warehouse holding stock is destroyed. */
export interface WarehouseLoss {
  buildingId: number;
  massKg: number;
  oreKg: Record<string, number>;
}

/** Mass (kg) stored in one warehouse. */
export function warehouseStoredKg(l: LogisticsState, warehouseId: number): number {
  let total = 0;
  for (const f of l.fragments) {
    if (f.state === 'stored' && f.warehouseId === warehouseId) total += f.fragment.mass;
  }
  return total;
}

/** Stored contents of one warehouse: total, kg per ore id, and the barren remainder. */
export interface WarehouseStock {
  storedKg: number;
  oreKg: Record<string, number>;
  barrenKg: number;
}

/** Stored kg of one warehouse by ore, plus barren remainder. Same fragments as warehouseStoredKg. */
export function warehouseStockByOre(l: LogisticsState, warehouseId: number): WarehouseStock {
  let storedKg = 0;
  const stored = [];
  for (const f of l.fragments) {
    if (f.state !== 'stored' || f.warehouseId !== warehouseId) continue;
    storedKg += f.fragment.mass;
    stored.push(f.fragment);
  }
  return { storedKg, ...sumOreMass(stored, storedKg) };
}

/** Mass (kg) in transit to one warehouse, reserved but not yet stored. */
export function warehouseReservedKg(l: LogisticsState, warehouseId: number): number {
  let total = 0;
  for (const f of l.fragments) {
    if (f.state === 'in_transit' && f.warehouseId === warehouseId) total += f.fragment.mass;
  }
  return total;
}

/** Mass (kg) stored or in transit per warehouse id, in one pass over the fragments. */
export function warehouseUsedKgMap(l: { fragments: readonly { state: string; warehouseId?: number | null; fragment: { mass: number } }[] }): Map<number, number> {
  const used = new Map<number, number>();
  for (const f of l.fragments) {
    if (f.warehouseId == null || f.state === 'on_ground') continue;
    used.set(f.warehouseId, (used.get(f.warehouseId) ?? 0) + f.fragment.mass);
  }
  return used;
}

/** Free room (kg): capacity minus stored minus in-transit mass reserved for it. */
export function warehouseFreeKg(l: LogisticsState, site: WarehouseSite, used?: ReadonlyMap<number, number>): number {
  return site.capacityKg - ((used ?? warehouseUsedKgMap(l)).get(site.id) ?? 0);
}

/** Largest free room (kg) any single warehouse offers; 0 with no warehouse. A trip unloads at one warehouse. */
export function largestWarehouseFreeKg(l: LogisticsState, sites: readonly WarehouseSite[]): number {
  const used = warehouseUsedKgMap(l);
  let best = 0;
  for (const site of sites) best = Math.max(best, warehouseFreeKg(l, site, used));
  return best;
}

/**
 * Nearest site with room for `massKg` (tie: lowest id), or null.
 * Callers scanning many fragments pass a `used` map built once by `warehouseUsedKgMap`.
 */
export function pickWarehouse(
  l: LogisticsState,
  sites: readonly WarehouseSite[],
  fromX: number,
  fromZ: number,
  massKg: number,
  used: ReadonlyMap<number, number> = warehouseUsedKgMap(l),
): WarehouseSite | null {
  return nearestSite(sites, fromX, fromZ, site => warehouseFreeKg(l, site, used) >= massKg);
}

/** Remove stock held by warehouses not in `liveIds`; debits `collectedOre`. */
export function loseOrphanedStock(
  l: LogisticsState,
  collectedOre: Record<string, number>,
  liveIds: ReadonlySet<number>,
): WarehouseLoss[] {
  const orphanIds = new Set<number>();
  for (const f of l.fragments) {
    const id = f.warehouseId;
    if (f.state === 'stored' && id !== null && !liveIds.has(id)) orphanIds.add(id);
  }
  if (orphanIds.size === 0) return [];
  const losses: WarehouseLoss[] = [...orphanIds].sort((a, b) => a - b).map(id => {
    const { storedKg, oreKg } = warehouseStockByOre(l, id);
    return { buildingId: id, massKg: storedKg, oreKg };
  });
  const kept: TrackedFragment[] = [];
  for (const f of l.fragments) {
    const id = f.warehouseId;
    if (f.state !== 'stored' || id === null || !orphanIds.has(id)) {
      kept.push(f);
      continue;
    }
    decrementCollectedOre(collectedOre, f.fragment);
    l.storedMassKg = Math.max(0, l.storedMassKg - f.fragment.mass);
  }
  l.fragments = kept;
  clampCollectedOre(collectedOre);
  return losses;
}
