// Integration test: freight warehouse → contract sell flow + explosive warehouse blast gating.
//
// This test exercises multiple modules working together:
//   Building.ts      – getStorageCapacity, hasExplosivesForBlast, storeExplosives, consumeExplosives
//   Logistics.ts     – createLogisticsState, syncLogisticsCapacity
//   Contract.ts      – createContractState, acceptContract, deliverMaterials
//
// Scenarios covered:
//   1. No freight warehouse → storage capacity = 0
//   2. Place freight warehouse → capacity increases; syncLogisticsCapacity updates logistics state
//   3. Sold material revenue = amountKg × pricePerKg (using deterministic fixture contract)
//   4. Contract completes once full quantityKg is delivered
//   5. Explosive warehouse gates blasting: false when empty, true when stocked

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBuildingState,
  placeBuilding,
  getStorageCapacity,
  getBuildingDef,
  hasExplosivesForBlast,
  storeExplosives,
  consumeExplosives,
} from '../../src/core/entities/Building.js';
import {
  createLogisticsState,
  syncLogisticsCapacity,
} from '../../src/core/economy/Logistics.js';
import {
  createContractState,
  acceptContract,
  deliverMaterials,
} from '../../src/core/economy/Contract.js';
import type { BuildingState } from '../../src/core/entities/Building.js';
import type { LogisticsState } from '../../src/core/economy/Logistics.js';
import type { ContractState, Contract } from '../../src/core/economy/Contract.js';

// ─── Deterministic test fixture helpers ──────────────────────────────────────

/**
 * Insert a fixed ore_sale contract directly into the available list so tests
 * are fully deterministic — no RNG involved.
 */
function insertOreSaleContract(
  state: ContractState,
  quantityKg: number,
  pricePerKg: number,
): Contract {
  const id = state.nextId++;
  const contract: Contract = {
    id,
    type: 'ore_sale',
    materialId: 'blingite',
    description: `[test fixture] deliver ${quantityKg} kg blingite @ $${pricePerKg}/kg`,
    quantityKg,
    deliveredKg: 0,
    pricePerKg,
    deadlineTicks: 500,
    acceptedAtTick: 0,
    penaltyAmount: Math.round(quantityKg * pricePerKg * 0.3),
    earlyBonus: Math.round(quantityKg * pricePerKg * 0.15),
    completed: false,
    expired: false,
  };
  state.available.push(contract);
  return contract;
}

// ─── Shared setup ─────────────────────────────────────────────────────────────

let buildingState: BuildingState;
let logisticsState: LogisticsState;
let contractState: ContractState;

beforeEach(() => {
  buildingState = createBuildingState();
  logisticsState = createLogisticsState(0);
  contractState = createContractState();
});

// ─── 1. Freight warehouse storage capacity lifecycle ─────────────────────────

describe('Freight warehouse storage capacity lifecycle', () => {
  it('storage capacity is 0 with no freight warehouses placed', () => {
    expect(getStorageCapacity(buildingState)).toBe(0);
  });

  it('syncLogisticsCapacity mirrors the 0-capacity state before any warehouse is placed', () => {
    syncLogisticsCapacity(logisticsState, getStorageCapacity(buildingState));
    expect(logisticsState.storageCapacityKg).toBe(0);
  });

  it('placing a tier-1 freight warehouse raises getStorageCapacity above zero', () => {
    placeBuilding(buildingState, 'freight_warehouse', 0, 0, 64, 64, 1);
    expect(getStorageCapacity(buildingState)).toBeGreaterThan(0);
  });

  it('after placement, syncLogisticsCapacity propagates capacity to LogisticsState', () => {
    placeBuilding(buildingState, 'freight_warehouse', 0, 0, 64, 64, 1);
    const cap = getStorageCapacity(buildingState);
    syncLogisticsCapacity(logisticsState, cap);
    expect(logisticsState.storageCapacityKg).toBe(cap);
    expect(logisticsState.storageCapacityKg).toBeGreaterThan(0);
  });

  it('capacity equals the BuildingDef capacity of a tier-1 freight warehouse', () => {
    placeBuilding(buildingState, 'freight_warehouse', 0, 0, 64, 64, 1);
    expect(getStorageCapacity(buildingState)).toBe(
      getBuildingDef('freight_warehouse', 1).capacity,
    );
  });

  it('placing a second tier-1 freight warehouse doubles total capacity', () => {
    placeBuilding(buildingState, 'freight_warehouse', 0,  0, 64, 64, 1);
    const single = getStorageCapacity(buildingState);

    // freight warehouse tier-1 footprint is 4×4; place second at (10, 0)
    placeBuilding(buildingState, 'freight_warehouse', 10, 0, 64, 64, 1);
    expect(getStorageCapacity(buildingState)).toBe(single * 2);
  });

  it('syncLogisticsCapacity reflects the doubled capacity after two warehouses', () => {
    placeBuilding(buildingState, 'freight_warehouse', 0,  0, 64, 64, 1);
    placeBuilding(buildingState, 'freight_warehouse', 10, 0, 64, 64, 1);
    const cap = getStorageCapacity(buildingState);
    syncLogisticsCapacity(logisticsState, cap);
    expect(logisticsState.storageCapacityKg).toBe(
      getBuildingDef('freight_warehouse', 1).capacity * 2,
    );
  });
});

// ─── 2. Contract sell flow: stored material → revenue ────────────────────────

describe('Contract sell flow: stored material → revenue', () => {
  it('revenue from partial delivery equals deliveredKg × pricePerKg', () => {
    const quantityKg = 200;
    const pricePerKg = 10;
    const contract = insertOreSaleContract(contractState, quantityKg, pricePerKg);
    acceptContract(contractState, contract.id, 0);

    const deliveredKg = 100;
    const result = deliverMaterials(contractState, contract.id, deliveredKg, 5);

    expect(result.payment).toBe(deliveredKg * pricePerKg); // 1 000
    expect(result.completed).toBe(false);
  });

  it('payment is zero for a contract that does not exist', () => {
    const result = deliverMaterials(contractState, 9999, 100, 5);
    expect(result.payment).toBe(0);
    expect(result.completed).toBe(false);
  });

  it('contract is not yet complete after partial delivery', () => {
    const contract = insertOreSaleContract(contractState, 100, 5);
    acceptContract(contractState, contract.id, 0);

    deliverMaterials(contractState, contract.id, 50, 5);
    expect(contractState.active.length).toBe(1);
    expect(contractState.completedHistory.length).toBe(0);
  });

  it('contract moves to completedHistory when full quantity is delivered', () => {
    const quantityKg = 100;
    const pricePerKg = 8;
    const contract = insertOreSaleContract(contractState, quantityKg, pricePerKg);
    acceptContract(contractState, contract.id, 0);

    const result = deliverMaterials(contractState, contract.id, quantityKg, 10);

    expect(result.completed).toBe(true);
    expect(result.payment).toBe(quantityKg * pricePerKg); // 800
    expect(contractState.active.length).toBe(0);
    expect(contractState.completedHistory.length).toBe(1);
  });

  it('total revenue across two partial deliveries equals quantityKg × pricePerKg', () => {
    const quantityKg = 300;
    const pricePerKg = 4;
    const contract = insertOreSaleContract(contractState, quantityKg, pricePerKg);
    acceptContract(contractState, contract.id, 0);

    const r1 = deliverMaterials(contractState, contract.id, 150, 5);
    const r2 = deliverMaterials(contractState, contract.id, 150, 10);

    expect(r1.payment + r2.payment).toBe(quantityKg * pricePerKg); // 1 200
    expect(r2.completed).toBe(true);
  });

  it('delivering more than remaining quantity completes the contract at the remainder', () => {
    const quantityKg = 100;
    const pricePerKg = 6;
    const contract = insertOreSaleContract(contractState, quantityKg, pricePerKg);
    acceptContract(contractState, contract.id, 0);

    // Over-deliver: 150 kg against a 100 kg contract
    const result = deliverMaterials(contractState, contract.id, 150, 5);
    expect(result.completed).toBe(true);
    // Payment is for exactly quantityKg (remainder is capped)
    expect(result.payment).toBe(quantityKg * pricePerKg); // 600
  });

  it('delivering against a completed contract returns zero payment', () => {
    const contract = insertOreSaleContract(contractState, 100, 5);
    acceptContract(contractState, contract.id, 0);
    deliverMaterials(contractState, contract.id, 100, 5); // completes contract

    // Attempt second delivery against an already-completed contract
    const result = deliverMaterials(contractState, contract.id, 50, 6);
    expect(result.payment).toBe(0);
    expect(result.completed).toBe(false);
  });
});

// ─── 3. Explosive warehouse blast gating ────────────────────────────────────

describe('Explosive warehouse blast gating', () => {
  it('hasExplosivesForBlast is false with no explosive warehouses at all', () => {
    expect(hasExplosivesForBlast(buildingState)).toBe(false);
  });

  it('hasExplosivesForBlast is false when a warehouse is placed but never stocked', () => {
    placeBuilding(buildingState, 'explosive_warehouse', 0, 0, 64, 64, 1);
    expect(hasExplosivesForBlast(buildingState)).toBe(false);
  });

  it('hasExplosivesForBlast becomes true after stocking a warehouse', () => {
    placeBuilding(buildingState, 'explosive_warehouse', 0, 0, 64, 64, 1);
    storeExplosives(buildingState, 100);
    expect(hasExplosivesForBlast(buildingState)).toBe(true);
  });

  it('hasExplosivesForBlast returns false again after all stock is consumed', () => {
    placeBuilding(buildingState, 'explosive_warehouse', 0, 0, 64, 64, 1);
    storeExplosives(buildingState, 100);
    consumeExplosives(buildingState, 100);
    expect(hasExplosivesForBlast(buildingState)).toBe(false);
  });

  it('warehouse gates are independent: one empty + one stocked → still true', () => {
    // Two warehouses; only second gets stock
    placeBuilding(buildingState, 'explosive_warehouse', 0,  0, 64, 64, 1);
    placeBuilding(buildingState, 'explosive_warehouse', 10, 0, 64, 64, 1);
    storeExplosives(buildingState, 1); // minimal — goes into first available slot
    expect(hasExplosivesForBlast(buildingState)).toBe(true);
  });

  it('warehouse + freight warehouse combo: each system is independent', () => {
    // A freight warehouse does NOT gate blasting
    placeBuilding(buildingState, 'freight_warehouse',   0,  0, 64, 64, 1);
    placeBuilding(buildingState, 'explosive_warehouse', 10, 0, 64, 64, 1);

    // Explosive warehouse empty → blast gated
    expect(hasExplosivesForBlast(buildingState)).toBe(false);

    // Stock explosive warehouse → blast allowed
    storeExplosives(buildingState, 50);
    expect(hasExplosivesForBlast(buildingState)).toBe(true);

    // Freight warehouse capacity should remain accessible and non-zero
    expect(getStorageCapacity(buildingState)).toBeGreaterThan(0);
  });
});
