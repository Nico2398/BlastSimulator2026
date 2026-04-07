// Explosive warehouse capacities from BuildingDefs.ts:
//   Tier 1: 500 kg  |  Tier 2: 1500 kg  |  Tier 3: 4000 kg

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBuildingState,
  placeBuilding,
  getBuildingDef,
  getStorageCapacity,
  getExplosivesCapacity,
  getExplosivesInStock,
  storeExplosives,
  consumeExplosives,
  hasExplosivesForBlast,
  freightWarehouseHasRoom,
} from '../../../src/core/entities/Building.js';
import {
  createLogisticsState,
  syncLogisticsCapacity,
} from '../../../src/core/economy/Logistics.js';
import type { BuildingState } from '../../../src/core/entities/Building.js';
import type { LogisticsState } from '../../../src/core/economy/Logistics.js';

// ─── BuildingDef sanity checks (already implemented) ─────────────────────────

describe('Explosive warehouse BuildingDef capacity values', () => {
  it('tier-1 explosive warehouse has 500 kg capacity', () => {
    expect(getBuildingDef('explosive_warehouse', 1).capacity).toBe(500);
  });

  it('tier-2 explosive warehouse has 1500 kg capacity', () => {
    expect(getBuildingDef('explosive_warehouse', 2).capacity).toBe(1500);
  });

  it('tier-3 explosive warehouse has 4000 kg capacity', () => {
    expect(getBuildingDef('explosive_warehouse', 3).capacity).toBe(4000);
  });
});

// ─── getExplosivesCapacity ────────────────────────────────────────────────────

describe('getExplosivesCapacity', () => {
  let state: BuildingState;

  beforeEach(() => { state = createBuildingState(); });

  it('returns 0 when no buildings exist', () => {
    expect(getExplosivesCapacity(state)).toBe(0);
  });

  it('returns 0 when no explosive warehouses are placed', () => {
    placeBuilding(state, 'freight_warehouse', 0, 0, 64, 64, 1);
    expect(getExplosivesCapacity(state)).toBe(0);
  });

  it('returns 500 for a single tier-1 explosive warehouse', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    expect(getExplosivesCapacity(state)).toBe(500);
  });

  it('returns 1500 for a single tier-2 explosive warehouse', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 2);
    expect(getExplosivesCapacity(state)).toBe(1500);
  });

  it('returns 4000 for a single tier-3 explosive warehouse', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 3);
    expect(getExplosivesCapacity(state)).toBe(4000);
  });

  it('sums capacity across two active warehouses (500 + 1500 = 2000)', () => {
    // tier-1 footprint 2×2 at (0,0); tier-2 footprint 3×2 at (10,0) — no overlap
    placeBuilding(state, 'explosive_warehouse', 0,  0, 64, 64, 1);
    placeBuilding(state, 'explosive_warehouse', 10, 0, 64, 64, 2);
    expect(getExplosivesCapacity(state)).toBe(2000);
  });

  it('excludes capacity from inactive warehouses', () => {
    placeBuilding(state, 'explosive_warehouse', 0,  0, 64, 64, 1);
    placeBuilding(state, 'explosive_warehouse', 10, 0, 64, 64, 1);
    state.buildings[1]!.active = false;
    // Only one active tier-1 → 500
    expect(getExplosivesCapacity(state)).toBe(500);
  });
});

// ─── getExplosivesInStock ─────────────────────────────────────────────────────

describe('getExplosivesInStock', () => {
  let state: BuildingState;

  beforeEach(() => { state = createBuildingState(); });

  it('returns 0 when no buildings exist', () => {
    expect(getExplosivesInStock(state)).toBe(0);
  });

  it('returns 0 when a warehouse has no storedExplosivesKg set (undefined treated as 0)', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    // storedExplosivesKg is undefined after placement
    expect(state.buildings[0]!.storedExplosivesKg).toBeUndefined();
    expect(getExplosivesInStock(state)).toBe(0);
  });

  it('returns the stored amount when explicitly set to 0', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    state.buildings[0]!.storedExplosivesKg = 0;
    expect(getExplosivesInStock(state)).toBe(0);
  });

  it('returns storedExplosivesKg for a single warehouse', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    state.buildings[0]!.storedExplosivesKg = 250;
    expect(getExplosivesInStock(state)).toBe(250);
  });

  it('sums storedExplosivesKg across multiple active warehouses', () => {
    placeBuilding(state, 'explosive_warehouse', 0,  0, 64, 64, 1);
    placeBuilding(state, 'explosive_warehouse', 10, 0, 64, 64, 1);
    state.buildings[0]!.storedExplosivesKg = 100;
    state.buildings[1]!.storedExplosivesKg = 200;
    expect(getExplosivesInStock(state)).toBe(300);
  });

  it('excludes stock from inactive warehouses', () => {
    placeBuilding(state, 'explosive_warehouse', 0,  0, 64, 64, 1);
    placeBuilding(state, 'explosive_warehouse', 10, 0, 64, 64, 1);
    state.buildings[0]!.storedExplosivesKg = 100;
    state.buildings[1]!.storedExplosivesKg = 200;
    state.buildings[1]!.active = false;
    expect(getExplosivesInStock(state)).toBe(100);
  });
});

// ─── storeExplosives ──────────────────────────────────────────────────────────

describe('storeExplosives', () => {
  let state: BuildingState;

  beforeEach(() => { state = createBuildingState(); });

  it('returns 0 and stores nothing when no warehouses exist', () => {
    const stored = storeExplosives(state, 100);
    expect(stored).toBe(0);
    expect(getExplosivesInStock(state)).toBe(0);
  });

  it('stores the requested amount and returns it when there is sufficient room', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1); // 500 kg capacity
    const stored = storeExplosives(state, 200);
    expect(stored).toBe(200);
    expect(getExplosivesInStock(state)).toBe(200);
  });

  it('caps storage at warehouse capacity and returns amount actually stored', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1); // 500 kg capacity
    const stored = storeExplosives(state, 700);   // request exceeds capacity
    expect(stored).toBe(500);                     // only 500 could be stored
    expect(getExplosivesInStock(state)).toBe(500);
  });

  it('distributes across warehouses when the first fills up (700 into two 500-kg slots)', () => {
    placeBuilding(state, 'explosive_warehouse', 0,  0, 64, 64, 1); // 500 kg
    placeBuilding(state, 'explosive_warehouse', 10, 0, 64, 64, 1); // 500 kg
    const stored = storeExplosives(state, 700);
    expect(stored).toBe(700);
    expect(getExplosivesInStock(state)).toBe(700);
  });

  it('can fill two warehouses to their combined capacity (1000 kg)', () => {
    placeBuilding(state, 'explosive_warehouse', 0,  0, 64, 64, 1); // 500 kg
    placeBuilding(state, 'explosive_warehouse', 10, 0, 64, 64, 1); // 500 kg
    const stored = storeExplosives(state, 1000);
    expect(stored).toBe(1000);
    expect(getExplosivesInStock(state)).toBe(1000);
  });

  it('respects existing stock when distributing (partial fill)', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1); // 500 kg capacity
    state.buildings[0]!.storedExplosivesKg = 400;                 // 100 kg free
    const stored = storeExplosives(state, 200);
    expect(stored).toBe(100);                   // only 100 kg of room left
    expect(getExplosivesInStock(state)).toBe(500);
  });

  it('does not store into inactive warehouses', () => {
    placeBuilding(state, 'explosive_warehouse', 0,  0, 64, 64, 1); // 500 kg active
    placeBuilding(state, 'explosive_warehouse', 10, 0, 64, 64, 1); // 500 kg inactive
    state.buildings[1]!.active = false;
    const stored = storeExplosives(state, 700);
    expect(stored).toBe(500); // only active warehouse has room
  });
});

// ─── consumeExplosives ────────────────────────────────────────────────────────

describe('consumeExplosives', () => {
  let state: BuildingState;

  beforeEach(() => { state = createBuildingState(); });

  it('returns false when no warehouses exist', () => {
    expect(consumeExplosives(state, 100)).toBe(false);
  });

  it('returns false when total stock is insufficient', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    state.buildings[0]!.storedExplosivesKg = 50;
    expect(consumeExplosives(state, 100)).toBe(false);
  });

  it('does NOT modify stock when returning false (insufficient)', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    state.buildings[0]!.storedExplosivesKg = 50;
    consumeExplosives(state, 100);          // fails
    expect(getExplosivesInStock(state)).toBe(50); // unchanged
  });

  it('returns true and deducts from warehouse stock on success', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    storeExplosives(state, 300);
    const ok = consumeExplosives(state, 100);
    expect(ok).toBe(true);
    expect(getExplosivesInStock(state)).toBe(200);
  });

  it('returns true when consuming the exact amount in stock (full drain)', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    storeExplosives(state, 200);
    expect(consumeExplosives(state, 200)).toBe(true);
    expect(getExplosivesInStock(state)).toBe(0);
  });

  it('can consume stock spread across multiple warehouses', () => {
    placeBuilding(state, 'explosive_warehouse', 0,  0, 64, 64, 1); // 500 kg
    placeBuilding(state, 'explosive_warehouse', 10, 0, 64, 64, 1); // 500 kg
    storeExplosives(state, 700);                // fills both: e.g. 500+200
    const ok = consumeExplosives(state, 600);
    expect(ok).toBe(true);
    expect(getExplosivesInStock(state)).toBe(100);
  });

  it('returns false when only inactive warehouses hold stock', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    storeExplosives(state, 100);
    state.buildings[0]!.active = false;
    expect(consumeExplosives(state, 50)).toBe(false);
  });
});

// ─── hasExplosivesForBlast ────────────────────────────────────────────────────

describe('hasExplosivesForBlast', () => {
  let state: BuildingState;

  beforeEach(() => { state = createBuildingState(); });

  it('returns false when no explosive warehouses exist', () => {
    expect(hasExplosivesForBlast(state)).toBe(false);
  });

  it('returns false when a warehouse exists but storedExplosivesKg is undefined', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    expect(state.buildings[0]!.storedExplosivesKg).toBeUndefined();
    expect(hasExplosivesForBlast(state)).toBe(false);
  });

  it('returns false when warehouse storedExplosivesKg is explicitly 0', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    state.buildings[0]!.storedExplosivesKg = 0;
    expect(hasExplosivesForBlast(state)).toBe(false);
  });

  it('returns true when at least one active warehouse has storedExplosivesKg > 0', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    storeExplosives(state, 1); // minimal stock
    expect(hasExplosivesForBlast(state)).toBe(true);
  });

  it('returns true after stocking a warehouse with a substantial amount', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    storeExplosives(state, 250);
    expect(hasExplosivesForBlast(state)).toBe(true);
  });

  it('returns false after all stock has been consumed', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    storeExplosives(state, 100);
    consumeExplosives(state, 100);
    expect(hasExplosivesForBlast(state)).toBe(false);
  });

  it('returns false when only inactive warehouses hold stock', () => {
    placeBuilding(state, 'explosive_warehouse', 0, 0, 64, 64, 1);
    storeExplosives(state, 100);
    state.buildings[0]!.active = false;
    expect(hasExplosivesForBlast(state)).toBe(false);
  });

  it('returns true when at least one active warehouse has stock even if others are empty', () => {
    placeBuilding(state, 'explosive_warehouse', 0,  0, 64, 64, 1);
    placeBuilding(state, 'explosive_warehouse', 10, 0, 64, 64, 1);
    // Only first warehouse gets stock
    state.buildings[0]!.storedExplosivesKg = 50;
    state.buildings[1]!.storedExplosivesKg = 0;
    expect(hasExplosivesForBlast(state)).toBe(true);
  });
});

// ─── freightWarehouseHasRoom ──────────────────────────────────────────────────

describe('freightWarehouseHasRoom', () => {
  it('returns false when no freight warehouses exist and additionalKg > 0', () => {
    const state = createBuildingState();
    // getStorageCapacity = 0 → 0 + 1 > 0 → no room
    expect(freightWarehouseHasRoom(state, 0, 1)).toBe(false);
  });

  it('returns true when adding fits within total storage capacity', () => {
    const state = createBuildingState();
    placeBuilding(state, 'freight_warehouse', 0, 0, 64, 64, 1); // 2000 kg
    // 500 stored + 500 additional = 1000 ≤ 2000
    expect(freightWarehouseHasRoom(state, 500, 500)).toBe(true);
  });

  it('returns false when adding would exceed total capacity', () => {
    const state = createBuildingState();
    placeBuilding(state, 'freight_warehouse', 0, 0, 64, 64, 1); // 2000 kg
    // 1900 + 200 = 2100 > 2000
    expect(freightWarehouseHasRoom(state, 1900, 200)).toBe(false);
  });

  it('returns true when currentStoredKg + additionalKg exactly equals capacity (boundary)', () => {
    const state = createBuildingState();
    placeBuilding(state, 'freight_warehouse', 0, 0, 64, 64, 1); // 2000 kg
    // 1000 + 1000 = 2000 ≤ 2000 → has room (boundary is inclusive)
    expect(freightWarehouseHasRoom(state, 1000, 1000)).toBe(true);
  });

  it('returns false when currentStoredKg alone exceeds capacity', () => {
    const state = createBuildingState();
    placeBuilding(state, 'freight_warehouse', 0, 0, 64, 64, 1); // 2000 kg
    expect(freightWarehouseHasRoom(state, 2001, 0)).toBe(false);
  });

  it('accounts for all active freight warehouses when checking room', () => {
    const state = createBuildingState();
    // Two tier-1 freight warehouses: 2000 + 2000 = 4000 total
    placeBuilding(state, 'freight_warehouse', 0,  0, 64, 64, 1);
    placeBuilding(state, 'freight_warehouse', 10, 0, 64, 64, 1);
    // 3500 + 400 = 3900 ≤ 4000 → true
    expect(freightWarehouseHasRoom(state, 3500, 400)).toBe(true);
    // 3500 + 600 = 4100 > 4000 → false
    expect(freightWarehouseHasRoom(state, 3500, 600)).toBe(false);
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
