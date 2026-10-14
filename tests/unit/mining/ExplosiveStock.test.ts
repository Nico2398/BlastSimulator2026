// BlastSimulator2026 — Unit tests: bulk explosive stock, pure helpers and purchase (#1678)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { placeBuilding, getBuildingDef } from '../../../src/core/entities/Building.js';
import { getExplosivesInStock } from '../../../src/core/entities/BuildingWarehouse.js';
import { getExplosive } from '../../../src/core/world/ExplosiveCatalog.js';
import { EXPLOSIVE_BULK_PRICE_FACTOR } from '../../../src/core/config/balance.js';
import {
  bulkPricePerKg, drawStockForOrder, buyExplosiveStock, returnOrderStock, explosivePriceFactor,
} from '../../../src/core/mining/ExplosiveStock.js';

function makeState(cash = 100_000, warehouses = 1, tier: 1 | 2 | 3 = 1): GameState {
  const state = createGame({ seed: 42, startingCash: cash });
  state.cash = cash;
  state.finances.cash = cash;
  for (let i = 0; i < warehouses; i++) {
    placeBuilding(state.buildings, 'explosive_warehouse', 5 + i * 10, 5, 64, 64, tier);
  }
  return state;
}

describe('bulkPricePerKg', () => {
  it('is catalog cost x bulk factor x price factor', () => {
    const boomite = getExplosive('boomite')!;
    expect(bulkPricePerKg('boomite', 1)).toBeCloseTo(boomite.costPerKg * EXPLOSIVE_BULK_PRICE_FACTOR, 10);
    expect(bulkPricePerKg('boomite', 1.5)).toBeCloseTo(boomite.costPerKg * EXPLOSIVE_BULK_PRICE_FACTOR * 1.5, 10);
  });

  it('is 8.4 per kg for boomite at the 0.7 bulk factor', () => {
    expect(EXPLOSIVE_BULK_PRICE_FACTOR).toBe(0.7);
    expect(bulkPricePerKg('boomite', 1)).toBeCloseTo(8.4, 10);
  });

  it('is strictly cheaper than the list price', () => {
    for (const id of ['pop_rock', 'boomite', 'krackle', 'big_bada_boom']) {
      expect(bulkPricePerKg(id, 1)).toBeLessThan(getExplosive(id)!.costPerKg);
    }
  });

  it('is 0 for an unknown explosive', () => {
    expect(bulkPricePerKg('no_such_explosive', 1)).toBe(0);
  });

  it('is 0 at a price factor of 0', () => {
    expect(bulkPricePerKg('boomite', 0)).toBe(0);
  });
});

describe('explosivePriceFactor', () => {
  it('is 1 with no live price modifiers', () => {
    expect(explosivePriceFactor(makeState())).toBe(1);
  });
});

describe('drawStockForOrder', () => {
  it('serves the whole order from stock when stock covers it', () => {
    expect(drawStockForOrder({ boomite: 100 }, 'boomite', 5)).toEqual({ fromStockKg: 5, fromCashKg: 0 });
  });

  it('serves the stocked part from stock and the rest from cash', () => {
    expect(drawStockForOrder({ boomite: 3 }, 'boomite', 5)).toEqual({ fromStockKg: 3, fromCashKg: 2 });
  });

  it('pays all in cash with no stock of that explosive', () => {
    expect(drawStockForOrder({}, 'boomite', 5)).toEqual({ fromStockKg: 0, fromCashKg: 5 });
  });

  it('never draws a different explosive', () => {
    expect(drawStockForOrder({ krackle: 500 }, 'boomite', 5)).toEqual({ fromStockKg: 0, fromCashKg: 5 });
  });

  it('draws exactly the stock when stock equals the order (boundary)', () => {
    expect(drawStockForOrder({ boomite: 5 }, 'boomite', 5)).toEqual({ fromStockKg: 5, fromCashKg: 0 });
  });

  it('returns zeros for a zero-kg order', () => {
    expect(drawStockForOrder({ boomite: 5 }, 'boomite', 0)).toEqual({ fromStockKg: 0, fromCashKg: 0 });
  });

  it('is pure: does not mutate the stock record', () => {
    const stock = Object.freeze({ boomite: 3 });
    expect(() => drawStockForOrder(stock, 'boomite', 5)).not.toThrow();
    expect(stock).toEqual({ boomite: 3 });
  });
});

describe('buyExplosiveStock', () => {
  it('stocks the kg and charges kg x bulk price', () => {
    const state = makeState(100_000);
    const r = buyExplosiveStock(state, 'boomite', 100);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.kg).toBe(100);
    expect(r.pricePerKg).toBeCloseTo(8.4, 10);
    expect(r.cost).toBeCloseTo(840, 6);
    expect(r.stockKg).toBe(100);
    expect(r.capacityKg).toBe(getBuildingDef('explosive_warehouse', 1).capacity);
    expect(state.cash).toBeCloseTo(100_000 - 840, 6);
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(100);
  });

  it('accepts a fill to exactly the capacity (boundary)', () => {
    const state = makeState(100_000);
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;
    expect(buyExplosiveStock(state, 'boomite', cap).success).toBe(true);
    expect(getExplosivesInStock(state.buildings)).toBe(cap);
  });

  it('accepts a purchase that costs exactly the cash on hand (boundary)', () => {
    const state = makeState(840.0000001);
    expect(buyExplosiveStock(state, 'boomite', 100).success).toBe(true);
  });

  it('refuses beyond capacity, naming the free kg, without mutation', () => {
    const state = makeState(1_000_000);
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;
    expect(buyExplosiveStock(state, 'boomite', cap - 10).success).toBe(true);
    const cash = state.cash;
    const r = buyExplosiveStock(state, 'boomite', 11);
    expect(r).toMatchObject({ success: false, reason: 'over_capacity', freeKg: 10 });
    expect(state.cash).toBe(cash);
    expect(getExplosivesInStock(state.buildings)).toBe(cap - 10);
  });

  it('shares capacity across explosive types', () => {
    const state = makeState(1_000_000);
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;
    expect(buyExplosiveStock(state, 'boomite', cap - 100).success).toBe(true);
    const r = buyExplosiveStock(state, 'krackle', 101);
    expect(r).toMatchObject({ success: false, reason: 'over_capacity' });
    expect(buyExplosiveStock(state, 'krackle', 100).success).toBe(true);
  });

  it('sums the capacity of several warehouses', () => {
    const state = makeState(1_000_000, 2);
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;
    expect(buyExplosiveStock(state, 'boomite', cap * 2).success).toBe(true);
  });

  it('refuses with no warehouse', () => {
    const state = makeState(100_000, 0);
    expect(buyExplosiveStock(state, 'boomite', 10)).toMatchObject({ success: false, reason: 'no_warehouse' });
    expect(state.cash).toBe(100_000);
  });

  it('refuses with only an inactive warehouse', () => {
    const state = makeState(100_000);
    state.buildings.buildings[0]!.active = false;
    expect(buyExplosiveStock(state, 'boomite', 10)).toMatchObject({ success: false, reason: 'no_warehouse' });
  });

  it('refuses with only an out-of-service warehouse', () => {
    const state = makeState(100_000);
    state.buildings.buildings[0]!.outOfService = true;
    expect(buyExplosiveStock(state, 'boomite', 10)).toMatchObject({ success: false, reason: 'no_warehouse' });
  });

  it('refuses on insufficient funds, naming the need, without mutation', () => {
    const state = makeState(100);
    const r = buyExplosiveStock(state, 'boomite', 100);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.reason).toBe('insufficient_funds');
    expect(r.need).toBeCloseTo(840, 6);
    expect(state.cash).toBe(100);
    expect(getExplosivesInStock(state.buildings)).toBe(0);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('refuses invalid amount %s', (kg) => {
    const state = makeState();
    expect(buyExplosiveStock(state, 'boomite', kg)).toMatchObject({ success: false, reason: 'invalid_amount' });
    expect(state.cash).toBe(100_000);
  });

  it('refuses an unknown explosive', () => {
    const state = makeState();
    expect(buyExplosiveStock(state, 'no_such_explosive', 10)).toMatchObject({ success: false, reason: 'unknown_explosive' });
  });

  it('refuses an explosive the level does not offer', () => {
    const state = makeState();
    state.campaign.activeLevelId = 'tutorial_pit';
    expect(buyExplosiveStock(state, 'krackle', 10)).toMatchObject({ success: false, reason: 'not_available' });
    expect(buyExplosiveStock(state, 'boomite', 10).success).toBe(true);
  });

  it('records the purchase as an explosives expense', () => {
    const state = makeState();
    buyExplosiveStock(state, 'boomite', 100);
    expect(state.finances.transactions.some(t => t.category === 'explosives')).toBe(true);
  });
});

describe('returnOrderStock', () => {
  it('restocks kg that fit and returns 0 cash', () => {
    const state = makeState();
    expect(returnOrderStock(state, 'boomite', 5)).toBe(0);
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(5);
  });

  it('returns the bulk-price value in cash for kg that no warehouse can hold', () => {
    const state = makeState(100_000, 0);
    expect(returnOrderStock(state, 'boomite', 5)).toBeCloseTo(5 * 8.4, 6);
  });

  it('restocks the part that fits and returns cash for the remainder', () => {
    const state = makeState(1_000_000);
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;
    buyExplosiveStock(state, 'krackle', cap - 2);
    const cash = returnOrderStock(state, 'boomite', 5);
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(2);
    expect(cash).toBeCloseTo(3 * 8.4, 6);
  });
});
