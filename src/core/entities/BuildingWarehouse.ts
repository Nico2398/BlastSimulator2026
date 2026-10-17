// BlastSimulator2026 — Warehouse operations
// Explosive Warehouse stock management and Freight Warehouse capacity checks.

import type { Building, BuildingState } from './Building.js';
import { getBuildingDef, getStorageCapacity, isOperating, spoilHeapRoomKg, warehouseFreeKg, warehouseStockKg } from './Building.js';

// ── Explosive Warehouse ──────────────────────────────────────────────────────

/** Total explosive storage capacity (kg) across all active explosive warehouses. */
export function getExplosivesCapacity(state: BuildingState): number {
  let total = 0;
  for (const b of state.buildings) {
    if (isOperating(b) && b.type === 'explosive_warehouse') {
      total += getBuildingDef(b.type, b.tier).capacity;
    }
  }
  return total;
}

/** Stock below this is float residue and is dropped from a warehouse's record. */
const STOCK_EPSILON_KG = 1e-6;

function operatingExplosiveWarehouses(state: BuildingState): Building[] {
  return state.buildings.filter(b => isOperating(b) && b.type === 'explosive_warehouse');
}

/** Explosives stored (kg) across active explosive warehouses: one explosive id, or all when omitted. */
export function getExplosivesInStock(state: BuildingState, explosiveId?: string): number {
  let total = 0;
  for (const b of operatingExplosiveWarehouses(state)) {
    total += explosiveId === undefined ? warehouseStockKg(b) : (b.storedExplosives?.[explosiveId] ?? 0);
  }
  return total;
}

/** Stored explosives (kg) by explosive id across active explosive warehouses. */
export function getExplosivesStockByType(state: BuildingState): Record<string, number> {
  const byType: Record<string, number> = {};
  for (const b of operatingExplosiveWarehouses(state)) {
    for (const [id, kg] of Object.entries(b.storedExplosives ?? {})) byType[id] = (byType[id] ?? 0) + kg;
  }
  return byType;
}

/** Unused explosive storage (kg) across active explosive warehouses. */
export function getExplosivesFreeCapacity(state: BuildingState): number {
  let free = 0;
  for (const b of operatingExplosiveWarehouses(state)) {
    free += warehouseFreeKg(b);
  }
  return free;
}

/**
 * Store explosives of one id in available warehouse space, filling warehouses in placement order.
 * Capacity is shared across explosive types.
 * @returns Amount actually stored (may be less than requested if capacity is full).
 */
export function storeExplosives(state: BuildingState, explosiveId: string, amountKg: number): number {
  let remaining = amountKg;
  for (const b of operatingExplosiveWarehouses(state)) {
    if (remaining <= 0) break;
    const available = getBuildingDef(b.type, b.tier).capacity - warehouseStockKg(b);
    if (available <= 0) continue;
    const toStore = Math.min(remaining, available);
    const stock = b.storedExplosives ?? {};
    stock[explosiveId] = (stock[explosiveId] ?? 0) + toStore;
    b.storedExplosives = stock;
    remaining -= toStore;
  }
  return amountKg - remaining;
}

/**
 * Consume explosives of one id from warehouse(s).
 * @returns true if sufficient stock was available and deducted; false otherwise (state unchanged).
 */
export function consumeExplosives(state: BuildingState, explosiveId: string, amountKg: number): boolean {
  if (getExplosivesInStock(state, explosiveId) < amountKg) return false;
  let remaining = amountKg;
  for (const b of operatingExplosiveWarehouses(state)) {
    if (remaining <= 0) break;
    const stock = b.storedExplosives;
    const current = stock?.[explosiveId] ?? 0;
    if (!stock || current <= 0) continue;
    const toConsume = Math.min(remaining, current);
    const left = current - toConsume;
    if (left < STOCK_EPSILON_KG) delete stock[explosiveId];
    else stock[explosiveId] = left;
    remaining -= toConsume;
  }
  return true;
}

/** Returns true if at least one active explosive warehouse has stock > 0. */
export function hasExplosivesForBlast(state: BuildingState): boolean {
  return operatingExplosiveWarehouses(state).some(b => warehouseStockKg(b) > 0);
}

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
