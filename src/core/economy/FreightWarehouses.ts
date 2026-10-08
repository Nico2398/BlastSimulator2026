// BlastSimulator2026 — Per-warehouse freight storage behind the shared pool (#1372)

import type { WarehouseSite } from '../entities/BuildingWarehouse.js';
import type { LogisticsState, TrackedFragment } from './Logistics.js';
import { accumulateOreMass, decrementCollectedOre } from '../mining/BlastOreReport.js';

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

/** Mass (kg) stored or in transit per warehouse id, in one pass over the fragments. */
export function warehouseUsedKgMap(l: LogisticsState): Map<number, number> {
  const used = new Map<number, number>();
  for (const f of l.fragments) {
    if (f.warehouseId === null || f.state === 'on_ground') continue;
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
  let best: WarehouseSite | null = null;
  let bestDist = Infinity;
  for (const site of sites) {
    if (warehouseFreeKg(l, site, used) < massKg) continue;
    const dist = (site.x - fromX) ** 2 + (site.z - fromZ) ** 2;
    if (dist < bestDist || (dist === bestDist && best !== null && site.id < best.id)) {
      best = site;
      bestDist = dist;
    }
  }
  return best;
}

/** Remove stock held by warehouses not in `liveIds`; debits `collectedOre`. */
export function loseOrphanedStock(
  l: LogisticsState,
  collectedOre: Record<string, number>,
  liveIds: ReadonlySet<number>,
): WarehouseLoss[] {
  const losses = new Map<number, WarehouseLoss>();
  const kept: TrackedFragment[] = [];
  for (const f of l.fragments) {
    const id = f.warehouseId;
    if (f.state !== 'stored' || id === null || liveIds.has(id)) {
      kept.push(f);
      continue;
    }
    let loss = losses.get(id);
    if (!loss) {
      loss = { buildingId: id, massKg: 0, oreKg: {} };
      losses.set(id, loss);
    }
    loss.massKg += f.fragment.mass;
    accumulateOreMass(loss.oreKg, f.fragment.volume, f.fragment.oreDensities);
    decrementCollectedOre(collectedOre, f.fragment);
    l.storedMassKg = Math.max(0, l.storedMassKg - f.fragment.mass);
  }
  if (losses.size === 0) return [];
  l.fragments = kept;
  for (const oreId of Object.keys(collectedOre)) {
    if (collectedOre[oreId]! < 0) collectedOre[oreId] = 0;
  }
  return [...losses.values()].sort((a, b) => a.buildingId - b.buildingId);
}
