// BlastSimulator2026 — Warehouse operations
// Explosive Warehouse stock management and Freight Warehouse capacity checks.

import type { BuildingState } from './Building.js';
import { getBuildingDef, getStorageCapacity, isOperating } from './Building.js';

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

/** Total explosives currently stored (kg) across all active explosive warehouses. */
export function getExplosivesInStock(state: BuildingState): number {
  let total = 0;
  for (const b of state.buildings) {
    if (isOperating(b) && b.type === 'explosive_warehouse') {
      total += b.storedExplosivesKg ?? 0;
    }
  }
  return total;
}

/**
 * Store explosives in available warehouse space.
 * Distributes across warehouses in placement order.
 * @returns Amount actually stored (may be less than requested if capacity is full).
 */
export function storeExplosives(state: BuildingState, amountKg: number): number {
  let remaining = amountKg;
  for (const b of state.buildings) {
    if (!isOperating(b) || b.type !== 'explosive_warehouse' || remaining <= 0) continue;
    const def = getBuildingDef(b.type, b.tier);
    const current = b.storedExplosivesKg ?? 0;
    const available = def.capacity - current;
    if (available <= 0) continue;
    const toStore = Math.min(remaining, available);
    b.storedExplosivesKg = current + toStore;
    remaining -= toStore;
  }
  return amountKg - remaining;
}

/**
 * Consume explosives from warehouse(s).
 * @returns true if sufficient stock was available and deducted; false otherwise (state unchanged).
 */
export function consumeExplosives(state: BuildingState, amountKg: number): boolean {
  if (getExplosivesInStock(state) < amountKg) return false;

  let remaining = amountKg;
  for (const b of state.buildings) {
    if (!isOperating(b) || b.type !== 'explosive_warehouse' || remaining <= 0) continue;
    const current = b.storedExplosivesKg ?? 0;
    if (current <= 0) continue;
    const toConsume = Math.min(remaining, current);
    b.storedExplosivesKg = current - toConsume;
    remaining -= toConsume;
  }
  return true;
}

/** Returns true if at least one active explosive warehouse has stock > 0. */
export function hasExplosivesForBlast(state: BuildingState): boolean {
  return state.buildings.some(
    b => isOperating(b) && b.type === 'explosive_warehouse' && (b.storedExplosivesKg ?? 0) > 0,
  );
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

/** Active spoil heaps as logistics sites (#1530); capacityKg is unbounded. */
export function spoilHeapSites(state: BuildingState): WarehouseSite[] {
  const sites: WarehouseSite[] = [];
  for (const b of state.buildings) {
    if (isOperating(b) && b.type === 'spoil_heap') {
      sites.push({ id: b.id, x: b.x, z: b.z, capacityKg: Infinity });
    }
  }
  return sites;
}
