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
//   6. Explosive stock commerce (#1678): bulk purchase, stock-first charge orders, refunds

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
import { createGame, type GameState } from '../../src/core/state/GameState.js';
import { getExplosivesInStock } from '../../src/core/entities/BuildingWarehouse.js';
import { buyExplosiveStock } from '../../src/core/mining/ExplosiveStock.js';
import {
  dispatchChargeAction, chargeFundsFailureAmount,
} from '../../src/core/mining/ChargeOrder.js';
import { cancelAction } from '../../src/core/engine/TaskCancellation.js';
import type { DrillHole } from '../../src/core/mining/DrillPlan.js';
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
    storeExplosives(buildingState, 'anfo', 100);
    expect(hasExplosivesForBlast(buildingState)).toBe(true);
  });

  it('hasExplosivesForBlast returns false again after all stock is consumed', () => {
    placeBuilding(buildingState, 'explosive_warehouse', 0, 0, 64, 64, 1);
    storeExplosives(buildingState, 'anfo', 100);
    consumeExplosives(buildingState, 'anfo', 100);
    expect(hasExplosivesForBlast(buildingState)).toBe(false);
  });

  it('warehouse gates are independent: one empty + one stocked → still true', () => {
    // Two warehouses; only second gets stock
    placeBuilding(buildingState, 'explosive_warehouse', 0,  0, 64, 64, 1);
    placeBuilding(buildingState, 'explosive_warehouse', 10, 0, 64, 64, 1);
    storeExplosives(buildingState, 'anfo', 1); // minimal — goes into first available slot
    expect(hasExplosivesForBlast(buildingState)).toBe(true);
  });

  it('warehouse + freight warehouse combo: each system is independent', () => {
    // A freight warehouse does NOT gate blasting
    placeBuilding(buildingState, 'freight_warehouse',   0,  0, 64, 64, 1);
    placeBuilding(buildingState, 'explosive_warehouse', 10, 0, 64, 64, 1);

    // Explosive warehouse empty → blast gated
    expect(hasExplosivesForBlast(buildingState)).toBe(false);

    // Stock explosive warehouse → blast allowed
    storeExplosives(buildingState, 'anfo', 50);
    expect(hasExplosivesForBlast(buildingState)).toBe(true);

    // Freight warehouse capacity should remain accessible and non-zero
    expect(getStorageCapacity(buildingState)).toBeGreaterThan(0);
  });
});

// ─── 4. Explosive stock commerce (#1678) ─────────────────────────────────────

const BOOMITE_LIST = 12;          // catalog $/kg
const BOOMITE_BULK = 12 * 0.7;    // bulk $/kg (EXPLOSIVE_BULK_PRICE_FACTOR)

function makeSite(cash: number, withWarehouse = true): GameState {
  const state = createGame({ seed: 42, startingCash: cash });
  state.cash = cash;
  state.finances.cash = cash;
  if (withWarehouse) placeBuilding(state.buildings, 'explosive_warehouse', 5, 5, 64, 64, 1);
  return state;
}

function hole(n: number): DrillHole {
  return { id: `H${n}`, x: 10 + n * 3, z: 10, depth: 8, diameter: 0.15 };
}

function order(state: GameState, n: number, kg: number, explosiveId = 'boomite') {
  dispatchChargeAction(state, hole(n), { explosiveId, amountKg: kg, stemmingM: 2 });
  return state.pendingActions.filter(a => a.type === 'charge_hole' && a.payload['holeId'] === `H${n}`);
}

describe('Buying explosive into warehouse stock', () => {
  it('charges the bulk price, cheaper than the list price', () => {
    const state = makeSite(50_000);
    const r = buyExplosiveStock(state, 'boomite', 100);
    expect(r.success).toBe(true);
    expect(state.cash).toBeCloseTo(50_000 - 100 * BOOMITE_BULK, 6);
    expect(100 * BOOMITE_BULK).toBeLessThan(100 * BOOMITE_LIST);
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(100);
  });

  it('is refused beyond capacity, leaving cash and stock untouched', () => {
    const state = makeSite(1_000_000);
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;
    const r = buyExplosiveStock(state, 'boomite', cap + 1);
    expect(r).toMatchObject({ success: false, reason: 'over_capacity', freeKg: cap });
    expect(state.cash).toBe(1_000_000);
    expect(getExplosivesInStock(state.buildings)).toBe(0);
  });

  it('is refused with no warehouse', () => {
    const state = makeSite(50_000, false);
    expect(buyExplosiveStock(state, 'boomite', 10)).toMatchObject({ success: false, reason: 'no_warehouse' });
    expect(state.cash).toBe(50_000);
  });

  it('is refused with an inoperative warehouse', () => {
    const state = makeSite(50_000);
    state.buildings.buildings[0]!.active = false;
    expect(buyExplosiveStock(state, 'boomite', 10)).toMatchObject({ success: false, reason: 'no_warehouse' });
    state.buildings.buildings[0]!.active = true;
    state.buildings.buildings[0]!.outOfService = true;
    expect(buyExplosiveStock(state, 'boomite', 10)).toMatchObject({ success: false, reason: 'no_warehouse' });
    expect(state.cash).toBe(50_000);
  });

  it('is refused on insufficient cash', () => {
    const state = makeSite(50);
    expect(buyExplosiveStock(state, 'boomite', 100)).toMatchObject({ success: false, reason: 'insufficient_funds' });
    expect(state.cash).toBe(50);
    expect(getExplosivesInStock(state.buildings)).toBe(0);
  });

  it('is refused for an invalid amount, an unknown explosive and an unavailable one', () => {
    const state = makeSite(50_000);
    expect(buyExplosiveStock(state, 'boomite', 0)).toMatchObject({ success: false, reason: 'invalid_amount' });
    expect(buyExplosiveStock(state, 'boomite', -3)).toMatchObject({ success: false, reason: 'invalid_amount' });
    expect(buyExplosiveStock(state, 'nope', 10)).toMatchObject({ success: false, reason: 'unknown_explosive' });
    state.campaign.activeLevelId = 'tutorial_pit';
    expect(buyExplosiveStock(state, 'krackle', 10)).toMatchObject({ success: false, reason: 'not_available' });
    expect(state.cash).toBe(50_000);
    expect(getExplosivesInStock(state.buildings)).toBe(0);
  });
});

describe('Charge orders draw from warehouse stock', () => {
  it('matching stock covers the order: no cash spent, orderCost 0, payload.orderStock set', () => {
    const state = makeSite(50_000);
    buyExplosiveStock(state, 'boomite', 100);
    const cash = state.cash;
    const [action] = order(state, 1, 5);
    expect(state.cash).toBe(cash);
    expect(action!.payload['orderCost']).toBe(0);
    expect(action!.payload['orderStock']).toEqual({ explosiveId: 'boomite', kg: 5 });
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(95);
  });

  it('partial stock is spent first, the remainder is paid in cash at list price', () => {
    const state = makeSite(50_000);
    buyExplosiveStock(state, 'boomite', 3);
    const cash = state.cash;
    const [action] = order(state, 1, 5);
    expect(state.cash).toBeCloseTo(cash - 2 * BOOMITE_LIST, 6);
    expect(action!.payload['orderCost']).toBeCloseTo(2 * BOOMITE_LIST, 6);
    expect(action!.payload['orderStock']).toEqual({ explosiveId: 'boomite', kg: 3 });
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(0);
  });

  it('stock of a different explosive is not drawn', () => {
    const state = makeSite(50_000);
    buyExplosiveStock(state, 'krackle', 100);
    const cash = state.cash;
    const [action] = order(state, 1, 5);
    expect(state.cash).toBeCloseTo(cash - 5 * BOOMITE_LIST, 6);
    expect(action!.payload['orderStock']).toBeUndefined();
    expect(getExplosivesInStock(state.buildings, 'krackle')).toBe(100);
  });

  it('with no warehouse an order costs exactly today\'s list price', () => {
    const state = makeSite(50_000, false);
    const [action] = order(state, 1, 5);
    expect(state.cash).toBe(50_000 - 60);
    expect(action!.payload['orderCost']).toBe(60);
    expect(action!.payload['orderStock']).toBeUndefined();
  });

  it('draws sequentially across a batch of orders', () => {
    const state = makeSite(50_000);
    buyExplosiveStock(state, 'boomite', 8);
    const cash = state.cash;
    const [a1] = order(state, 1, 5);
    const [a2] = order(state, 2, 5);
    expect(a1!.payload['orderStock']).toEqual({ explosiveId: 'boomite', kg: 5 });
    expect(a2!.payload['orderStock']).toEqual({ explosiveId: 'boomite', kg: 3 });
    expect(state.cash).toBeCloseTo(cash - 2 * BOOMITE_LIST, 6);
    expect(getExplosivesInStock(state.buildings)).toBe(0);
  });

  it('re-charging a hole restocks the old order before drawing the new one', () => {
    const state = makeSite(50_000);
    buyExplosiveStock(state, 'boomite', 100);
    const cash = state.cash;
    order(state, 1, 5);
    const actions = order(state, 1, 5);
    expect(actions).toHaveLength(1);
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(95);
    expect(state.cash).toBe(cash);
  });
});

describe('chargeFundsFailureAmount with stock', () => {
  const orders = (n: number, kg: number) =>
    Array.from({ length: n }, (_, i) => ({ holeId: `H${i + 1}`, explosiveId: 'boomite', amountKg: kg }));

  it('is null with cash 0 when stock covers the batch', () => {
    const state = makeSite(1_000);
    buyExplosiveStock(state, 'boomite', 100);
    state.cash = 0;
    expect(chargeFundsFailureAmount(state, orders(3, 5))).toBeNull();
  });

  it('counts stock sequentially across the batch: only the uncovered kg needs cash', () => {
    const state = makeSite(1_000);
    buyExplosiveStock(state, 'boomite', 8);
    state.cash = 0;
    const short = chargeFundsFailureAmount(state, orders(2, 5));
    expect(short).not.toBeNull();
    expect(short!.need).toBeCloseTo(2 * BOOMITE_LIST, 6);
    state.cash = 2 * BOOMITE_LIST;
    expect(chargeFundsFailureAmount(state, orders(2, 5))).toBeNull();
  });

  it('is unchanged without a warehouse', () => {
    const state = makeSite(10, false);
    expect(chargeFundsFailureAmount(state, orders(1, 5))).toEqual({ need: 60 });
  });
});

describe('Cancelling a charge order refunds in the currency paid', () => {
  it('a stock-paid order restocks the kg and refunds no cash', () => {
    const state = makeSite(50_000);
    buyExplosiveStock(state, 'boomite', 100);
    const cash = state.cash;
    const [action] = order(state, 1, 5);
    const r = cancelAction(state, action!.id);
    expect(r.success).toBe(true);
    expect(r.refundedStockKg).toBe(5);
    expect(state.cash).toBe(cash);
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(100);
  });

  it('a mixed order restocks the stock part and refunds only the cash part', () => {
    const state = makeSite(50_000);
    buyExplosiveStock(state, 'boomite', 3);
    const cash = state.cash;
    const [action] = order(state, 1, 5);
    const r = cancelAction(state, action!.id);
    expect(state.cash).toBeCloseTo(cash, 6);
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(3);
    expect(r.refundedStockKg).toBe(3);
    expect(r.refunded).toBeGreaterThan(0);
  });

  it('stock that no warehouse can take back is refunded as cash at the bulk price', () => {
    const state = makeSite(50_000);
    buyExplosiveStock(state, 'boomite', 100);
    const [action] = order(state, 1, 5);
    const cash = state.cash;
    state.buildings.buildings = [];
    const r = cancelAction(state, action!.id);
    expect(state.cash).toBeCloseTo(cash + 5 * BOOMITE_BULK, 6);
    expect(r.refunded).toBeCloseTo(5 * BOOMITE_BULK, 6);
    expect(r.refundedStockKg).toBeUndefined();
  });

  it('a partly storable return restocks what fits and reports the rest as refunded cash', () => {
    const state = makeSite(1_000_000);
    buyExplosiveStock(state, 'boomite', 100);
    const [action] = order(state, 1, 5);
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;
    buyExplosiveStock(state, 'boomite', cap - 2 - getExplosivesInStock(state.buildings));
    const cash = state.cash;
    const r = cancelAction(state, action!.id);
    expect(r.refundedStockKg).toBe(2);
    expect(r.refunded).toBeCloseTo(3 * BOOMITE_BULK, 6);
    expect(state.cash).toBeCloseTo(cash + 3 * BOOMITE_BULK, 6);
  });

  it('a cash-only order refunds exactly its cost, as before', () => {
    const state = makeSite(50_000, false);
    const [action] = order(state, 1, 5);
    cancelAction(state, action!.id);
    expect(state.cash).toBe(50_000);
  });
});
