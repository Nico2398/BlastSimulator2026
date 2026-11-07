import { describe, it, expect } from 'vitest';
import {
  createBuildingState,
  placeBuilding,
  getBuildingDef,
  getStorageCapacity,
  freightWarehouseHasRoom,
} from '../../../src/core/entities/Building.js';
import { freightWarehouseSites } from '../../../src/core/entities/BuildingWarehouse.js';
import {
  createLogisticsState,
  syncLogisticsCapacity,
} from '../../../src/core/economy/Logistics.js';
import type { LogisticsState } from '../../../src/core/economy/Logistics.js';

// ─── freightWarehouseHasRoom ──────────────────────────────────────────────────

describe('freightWarehouseHasRoom', () => {
  const CAP = getBuildingDef('freight_warehouse', 1).capacity;

  it('returns false when no freight warehouses exist and additionalKg > 0', () => {
    const state = createBuildingState();
    // getStorageCapacity = 0 → 0 + 1 > 0 → no room
    expect(freightWarehouseHasRoom(state, 0, 1)).toBe(false);
  });

  it('returns true when adding fits within total storage capacity', () => {
    const state = createBuildingState();
    placeBuilding(state, 'freight_warehouse', 0, 0, 64, 64, 1); // CAP kg
    // 500 stored + 500 additional = 1000 ≤ CAP
    expect(freightWarehouseHasRoom(state, 500, 500)).toBe(true);
  });

  it('returns false when adding would exceed total capacity', () => {
    const state = createBuildingState();
    placeBuilding(state, 'freight_warehouse', 0, 0, 64, 64, 1); // CAP kg
    // (CAP - 100) + 200 > CAP
    expect(freightWarehouseHasRoom(state, CAP - 100, 200)).toBe(false);
  });

  it('returns true when currentStoredKg + additionalKg exactly equals capacity (boundary)', () => {
    const state = createBuildingState();
    placeBuilding(state, 'freight_warehouse', 0, 0, 64, 64, 1); // CAP kg
    // stored + additional = CAP → has room (boundary is inclusive)
    expect(freightWarehouseHasRoom(state, CAP - 1000, 1000)).toBe(true);
  });

  it('returns false when currentStoredKg alone exceeds capacity', () => {
    const state = createBuildingState();
    placeBuilding(state, 'freight_warehouse', 0, 0, 64, 64, 1); // CAP kg
    expect(freightWarehouseHasRoom(state, CAP + 1, 0)).toBe(false);
  });

  it('accounts for all active freight warehouses when checking room', () => {
    const state = createBuildingState();
    // Two tier-1 freight warehouses: 2 * CAP total
    placeBuilding(state, 'freight_warehouse', 0,  0, 64, 64, 1);
    placeBuilding(state, 'freight_warehouse', 10, 0, 64, 64, 1);
    // (2*CAP - 500) + 400 ≤ 2*CAP → true
    expect(freightWarehouseHasRoom(state, 2 * CAP - 500, 400)).toBe(true);
    // (2*CAP - 500) + 600 > 2*CAP → false
    expect(freightWarehouseHasRoom(state, 2 * CAP - 500, 600)).toBe(false);
  });
});

// ─── syncLogisticsCapacity ────────────────────────────────────────────────────

describe('syncLogisticsCapacity', () => {
  it('updates storageCapacityKg to the provided value', () => {
    const logisticsState: LogisticsState = createLogisticsState(0);
    syncLogisticsCapacity(logisticsState, 5000);
    expect(logisticsState.storageCapacityKg).toBe(5000);
  });

  it('can set capacity to zero', () => {
    const logisticsState: LogisticsState = createLogisticsState(9999);
    syncLogisticsCapacity(logisticsState, 0);
    expect(logisticsState.storageCapacityKg).toBe(0);
  });

  it('can update capacity multiple times, always reflecting the latest value', () => {
    const logisticsState: LogisticsState = createLogisticsState(0);
    syncLogisticsCapacity(logisticsState, 1000);
    expect(logisticsState.storageCapacityKg).toBe(1000);
    syncLogisticsCapacity(logisticsState, 3000);
    expect(logisticsState.storageCapacityKg).toBe(3000);
  });

  it('syncing logistics capacity from building state reflects placed freight warehouses', () => {
    const buildingState = createBuildingState();
    const logisticsState: LogisticsState = createLogisticsState(0);

    placeBuilding(buildingState, 'freight_warehouse', 0, 0, 64, 64, 1);
    const capacityFromBuildings = getStorageCapacity(buildingState);
    syncLogisticsCapacity(logisticsState, capacityFromBuildings);

    expect(logisticsState.storageCapacityKg).toBe(capacityFromBuildings);
    expect(logisticsState.storageCapacityKg).toBeGreaterThan(0);
  });

  it('does not mutate other LogisticsState fields', () => {
    const logisticsState: LogisticsState = createLogisticsState(0);
    logisticsState.storedMassKg = 42;
    syncLogisticsCapacity(logisticsState, 9000);
    // storedMassKg must be untouched
    expect(logisticsState.storedMassKg).toBe(42);
    expect(logisticsState.fragments).toHaveLength(0);
  });
});

describe('freightWarehouseSites (#1372)', () => {
  it('is empty with no buildings', () => {
    expect(freightWarehouseSites(createBuildingState())).toEqual([]);
  });

  it('lists active freight warehouses with id, position and tier capacity', () => {
    const bs = createBuildingState();
    const a = placeBuilding(bs, 'freight_warehouse', 10, 10, 100, 100, 1);
    const b = placeBuilding(bs, 'freight_warehouse', 40, 10, 100, 100, 1);
    expect(a.success && b.success).toBe(true);
    b.building!.tier = 2; // placing tier 2 needs research; the upgrade itself is not under test
    const sites = freightWarehouseSites(bs);
    expect(sites).toHaveLength(2);
    const byId = new Map(sites.map(s => [s.id, s]));
    expect(byId.get(a.building!.id)!.capacityKg).toBe(getBuildingDef('freight_warehouse', 1).capacity);
    expect(byId.get(b.building!.id)!.capacityKg).toBe(getBuildingDef('freight_warehouse', 2).capacity);
    for (const s of sites) {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.z)).toBe(true);
    }
  });

  it('skips inactive freight warehouses and other building types', () => {
    const bs = createBuildingState();
    const a = placeBuilding(bs, 'freight_warehouse', 10, 10, 100, 100, 1);
    placeBuilding(bs, 'management_office', 40, 40, 100, 100, 1);
    a.building!.active = false;
    expect(freightWarehouseSites(bs)).toEqual([]);
  });

  it('capacities sum to getStorageCapacity', () => {
    const bs = createBuildingState();
    placeBuilding(bs, 'freight_warehouse', 10, 10, 100, 100, 1);
    placeBuilding(bs, 'freight_warehouse', 40, 10, 100, 100, 3);
    expect(freightWarehouseSites(bs).reduce((n, s) => n + s.capacityKg, 0)).toBe(getStorageCapacity(bs));
  });
});
