// BlastSimulator2026 — Per-warehouse freight storage behind the shared pool (#1372)

import type { WarehouseSite } from '../entities/BuildingWarehouse.js';
import type { LogisticsState } from './Logistics.js';

export type { WarehouseSite };

/** Ore and mass lost when a warehouse holding stock is destroyed. */
export interface WarehouseLoss {
  buildingId: number;
  massKg: number;
  oreKg: Record<string, number>;
}

/** Mass (kg) stored in one warehouse. */
export function warehouseStoredKg(_l: LogisticsState, _warehouseId: number): number {
  return 0; // TODO: implement
}

/** Free room (kg): capacity minus stored minus in-transit mass reserved for it. */
export function warehouseFreeKg(_l: LogisticsState, _site: WarehouseSite): number {
  return 0; // TODO: implement
}

/** Nearest site with room for `massKg` (tie: lowest id), or null. */
export function pickWarehouse(
  _l: LogisticsState,
  _sites: readonly WarehouseSite[],
  _fromX: number,
  _fromZ: number,
  _massKg: number,
): WarehouseSite | null {
  return null; // TODO: implement
}

/** Remove stock held by warehouses not in `liveIds`; debits `collectedOre`. */
export function loseOrphanedStock(
  _l: LogisticsState,
  _collectedOre: Record<string, number>,
  _liveIds: ReadonlySet<number>,
): WarehouseLoss[] {
  return []; // TODO: implement
}
