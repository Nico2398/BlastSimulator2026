// BlastSimulator2026 — Unit tests: bulk explosive stock, pure helpers and purchase (#1678)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { placeBuilding, getBuildingDef } from '../../../src/core/entities/Building.js';
import { getExplosivesInStock } from '../../../src/core/entities/BuildingWarehouse.js';
import { getExplosive } from '../../../src/core/world/ExplosiveCatalog.js';
import { EXPLOSIVE_BULK_PRICE_FACTOR } from '../../../src/core/config/balance.js';
import {
  bulkPricePerKg, drawStockForOrder, buyExplosiveStock, returnOrderStock, explosivePriceFactor, buyStockBlockReason,
  quoteChargeLoad, canAffordChargeLoad, loadChargeExplosive,
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
    const state = makeState();
    const cost = 100 * bulkPricePerKg('boomite', explosivePriceFactor(state));
    state.cash = cost;
    state.finances.cash = cost;
    expect(buyExplosiveStock(state, 'boomite', 100).success).toBe(true);
    expect(state.cash).toBe(0);
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
    expect(returnOrderStock(state, 'boomite', 5)).toEqual({ restockedKg: 5, cashRefund: 0 });
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(5);
  });

  it('returns the bulk-price value in cash for kg that no warehouse can hold', () => {
    const state = makeState(100_000, 0);
    const r = returnOrderStock(state, 'boomite', 5);
    expect(r.restockedKg).toBe(0);
    expect(r.cashRefund).toBeCloseTo(5 * 8.4, 6);
  });

  it('restocks the part that fits and returns cash for the remainder', () => {
    const state = makeState(1_000_000);
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;
    buyExplosiveStock(state, 'krackle', cap - 2);
    const r = returnOrderStock(state, 'boomite', 5);
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(2);
    expect(r.restockedKg).toBe(2);
    expect(r.cashRefund).toBeCloseTo(3 * 8.4, 6);
  });
});

describe('buyStockBlockReason (#1685)', () => {
  it('is null when the purchase would succeed', () => {
    expect(buyStockBlockReason(makeState(), 'boomite', 50)).toBeNull();
  });

  it('agrees with buyExplosiveStock on every refusal reason', () => {
    const cases: Array<[string, GameState, string, number]> = [
      ['invalid_amount', makeState(), 'boomite', 0],
      ['unknown_explosive', makeState(), 'no_such_explosive', 10],
      ['no_warehouse', makeState(100_000, 0), 'boomite', 10],
      ['over_capacity', makeState(), 'boomite', 100_000],
      ['insufficient_funds', makeState(100), 'boomite', 100],
    ];
    for (const [reason, state, id, kg] of cases) {
      expect(buyStockBlockReason(state, id, kg)).toBe(reason);
      const real = buyExplosiveStock(state, id, kg);
      expect(real.success).toBe(false);
      if (!real.success) expect(real.reason).toBe(reason);
    }
  });

  it('reports not_available for an explosive the level does not offer', () => {
    const state = makeState();
    state.campaign.activeLevelId = 'tutorial_pit';
    expect(buyStockBlockReason(state, 'krackle', 10)).toBe('not_available');
  });

  it('checks in order: invalid before unknown, no_warehouse before funds', () => {
    expect(buyStockBlockReason(makeState(), 'no_such_explosive', 0)).toBe('invalid_amount');
    expect(buyStockBlockReason(makeState(0, 0), 'boomite', 10)).toBe('no_warehouse');
    expect(buyStockBlockReason(makeState(0), 'boomite', 100_000)).toBe('over_capacity');
  });

  it('allows an exact fill and exact cash (boundaries)', () => {
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;
    const full = makeState(10_000_000);
    expect(buyStockBlockReason(full, 'boomite', cap)).toBeNull();
    expect(buyStockBlockReason(full, 'boomite', cap + 1)).toBe('over_capacity');
    const exact = makeState();
    const cost = 100 * bulkPricePerKg('boomite', explosivePriceFactor(exact));
    exact.cash = cost;
    expect(buyStockBlockReason(exact, 'boomite', 100)).toBeNull();
  });

  it('counts existing stock against capacity', () => {
    const state = makeState(1_000_000);
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;
    buyExplosiveStock(state, 'boomite', cap - 10);
    expect(buyStockBlockReason(state, 'krackle', 11)).toBe('over_capacity');
    expect(buyStockBlockReason(state, 'krackle', 10)).toBeNull();
  });

  it('mutates nothing', () => {
    const state = makeState();
    const cash = state.cash;
    buyStockBlockReason(state, 'boomite', 100);
    expect(state.cash).toBe(cash);
    expect(getExplosivesInStock(state.buildings)).toBe(0);
    expect(state.finances.transactions).toHaveLength(0);
  });
});

/** A live event modifier scaling explosive prices by `magnitude`. */
function raisePrices(state: GameState, magnitude: number): void {
  state.events.activeModifiers.push({
    id: 1, kind: 'explosive_price', sourceEventId: 'test', role: null, targetId: null,
    category: null, magnitude, startTick: 0, endTick: null,
  });
}

function setCash(state: GameState, cash: number): void {
  state.cash = cash;
  state.finances.cash = cash;
}

const BOOMITE_LIST_PER_KG = 12; // catalog costPerKg: pay-on-fill is at list price, not the bulk price

describe('quoteChargeLoad (#2143)', () => {
  it('with no stock pays every kg in cash at list price', () => {
    const state = makeState(100_000, 0);
    const q = quoteChargeLoad(state, 'boomite', 5);
    expect(q.fromStockKg).toBe(0);
    expect(q.fromCashKg).toBe(5);
    expect(q.cost).toBeCloseTo(5 * BOOMITE_LIST_PER_KG, 10);
  });

  it('prices at list, not at the cheaper bulk price', () => {
    const state = makeState(100_000, 0);
    expect(quoteChargeLoad(state, 'boomite', 10).cost).toBeGreaterThan(10 * bulkPricePerKg('boomite', 1));
  });

  it('full stock cover costs 0', () => {
    const state = makeState();
    buyExplosiveStock(state, 'boomite', 100);
    expect(quoteChargeLoad(state, 'boomite', 5)).toEqual({ fromStockKg: 5, fromCashKg: 0, cost: 0 });
  });

  it('partial stock covers its kg and only the remainder is paid in cash', () => {
    const state = makeState();
    buyExplosiveStock(state, 'boomite', 3);
    const q = quoteChargeLoad(state, 'boomite', 5);
    expect(q.fromStockKg).toBe(3);
    expect(q.fromCashKg).toBe(2);
    expect(q.cost).toBeCloseTo(2 * BOOMITE_LIST_PER_KG, 10);
  });

  it('stock exactly equal to the amount costs 0 (boundary)', () => {
    const state = makeState();
    buyExplosiveStock(state, 'boomite', 5);
    expect(quoteChargeLoad(state, 'boomite', 5).cost).toBe(0);
  });

  it('stock one kg short pays exactly one kg in cash (boundary)', () => {
    const state = makeState();
    buyExplosiveStock(state, 'boomite', 4);
    const q = quoteChargeLoad(state, 'boomite', 5);
    expect(q.fromCashKg).toBe(1);
    expect(q.cost).toBeCloseTo(BOOMITE_LIST_PER_KG, 10);
  });

  it('ignores stock of another explosive', () => {
    const state = makeState();
    buyExplosiveStock(state, 'krackle', 100);
    const q = quoteChargeLoad(state, 'boomite', 5);
    expect(q.fromStockKg).toBe(0);
    expect(q.cost).toBeCloseTo(5 * BOOMITE_LIST_PER_KG, 10);
  });

  it('applies the live explosive price factor to the cash part only', () => {
    const state = makeState();
    buyExplosiveStock(state, 'boomite', 3);
    raisePrices(state, 1.5);
    expect(quoteChargeLoad(state, 'boomite', 5).cost).toBeCloseTo(2 * BOOMITE_LIST_PER_KG * 1.5, 10);
  });

  it('an unknown explosive costs 0', () => {
    expect(quoteChargeLoad(makeState(), 'no_such_explosive', 5).cost).toBe(0);
  });

  it('a zero-kg load costs 0', () => {
    expect(quoteChargeLoad(makeState(100_000, 0), 'boomite', 0).cost).toBe(0);
  });

  it('is pure: changes neither stock, cash nor ledger', () => {
    const state = makeState();
    buyExplosiveStock(state, 'boomite', 3);
    const cash = state.cash;
    const txs = state.finances.transactions.length;
    quoteChargeLoad(state, 'boomite', 5);
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(3);
    expect(state.cash).toBe(cash);
    expect(state.finances.transactions).toHaveLength(txs);
  });
});

describe('canAffordChargeLoad (#2143)', () => {
  it('is true when cash covers the cash part', () => {
    const state = makeState(1000, 0);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(true);
  });

  it('is true when cash equals the cost exactly (boundary)', () => {
    const state = makeState(100_000, 0);
    setCash(state, 5 * BOOMITE_LIST_PER_KG);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(true);
  });

  it('is false when cash is one cent short (rejection)', () => {
    const state = makeState(100_000, 0);
    setCash(state, 5 * BOOMITE_LIST_PER_KG - 0.01);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(false);
  });

  it('is false with no cash and nothing stocked', () => {
    const state = makeState(100_000, 0);
    setCash(state, 0);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(false);
  });

  it('full stock cover is affordable at zero cash', () => {
    const state = makeState();
    buyExplosiveStock(state, 'boomite', 100);
    setCash(state, 0);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(true);
  });

  it('partial stock lowers the cash needed', () => {
    const state = makeState();
    buyExplosiveStock(state, 'boomite', 3);
    setCash(state, 2 * BOOMITE_LIST_PER_KG);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(true);
    setCash(state, 2 * BOOMITE_LIST_PER_KG - 0.01);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(false);
  });

  it('a price rise can turn an affordable load unaffordable', () => {
    const state = makeState(100_000, 0);
    setCash(state, 5 * BOOMITE_LIST_PER_KG);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(true);
    raisePrices(state, 1.5);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(false);
  });

  it('an unknown explosive is always affordable (costs 0)', () => {
    const state = makeState(100_000, 0);
    setCash(state, 0);
    expect(canAffordChargeLoad(state, 'no_such_explosive', 5)).toBe(true);
  });
});

describe('loadChargeExplosive (#2143)', () => {
  const explosivesTx = (state: GameState) => state.finances.transactions.filter(t => t.category === 'explosives');

  it('with no stock deducts the list-price cost from cash and books one explosives expense', () => {
    const state = makeState(10_000, 0);
    const r = loadChargeExplosive(state, 'boomite', 5);
    expect(r.fromStockKg).toBe(0);
    expect(r.cost).toBeCloseTo(60, 10);
    expect(state.cash).toBeCloseTo(10_000 - 60, 10);
    const tx = explosivesTx(state);
    expect(tx).toHaveLength(1);
    expect(tx[0]!.type).toBe('expense');
    expect(tx[0]!.amount).toBeCloseTo(60, 10);
  });

  it('draws stock first and pays only the remainder', () => {
    const state = makeState(10_000);
    buyExplosiveStock(state, 'boomite', 3);
    const cash = state.cash;
    const r = loadChargeExplosive(state, 'boomite', 5);
    expect(r.fromStockKg).toBe(3);
    expect(r.cost).toBeCloseTo(2 * BOOMITE_LIST_PER_KG, 10);
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(0);
    expect(state.cash).toBeCloseTo(cash - 2 * BOOMITE_LIST_PER_KG, 10);
  });

  it('full stock cover spends no cash and books no expense for the load', () => {
    const state = makeState(10_000);
    buyExplosiveStock(state, 'boomite', 100);
    const cash = state.cash;
    const before = explosivesTx(state).length;
    const r = loadChargeExplosive(state, 'boomite', 5);
    expect(r).toEqual({ fromStockKg: 5, cost: 0 });
    expect(state.cash).toBe(cash);
    expect(explosivesTx(state)).toHaveLength(before);
    expect(getExplosivesInStock(state.buildings, 'boomite')).toBe(95);
  });

  it('leaves another explosive in stock untouched', () => {
    const state = makeState(10_000);
    buyExplosiveStock(state, 'krackle', 50);
    loadChargeExplosive(state, 'boomite', 5);
    expect(getExplosivesInStock(state.buildings, 'krackle')).toBe(50);
  });

  it('applies the live price factor to the cash part', () => {
    const state = makeState(10_000, 0);
    raisePrices(state, 1.5);
    const r = loadChargeExplosive(state, 'boomite', 5);
    expect(r.cost).toBeCloseTo(90, 10);
    expect(state.cash).toBeCloseTo(10_000 - 90, 10);
  });

  it('an unknown explosive costs nothing and books nothing', () => {
    const state = makeState(10_000, 0);
    const r = loadChargeExplosive(state, 'no_such_explosive', 5);
    expect(r.cost).toBe(0);
    expect(state.cash).toBe(10_000);
    expect(explosivesTx(state)).toHaveLength(0);
  });

  it('agrees with quoteChargeLoad taken just before', () => {
    const state = makeState(10_000);
    buyExplosiveStock(state, 'boomite', 2);
    const q = quoteChargeLoad(state, 'boomite', 7);
    const r = loadChargeExplosive(state, 'boomite', 7);
    expect(r.fromStockKg).toBe(q.fromStockKg);
    expect(r.cost).toBeCloseTo(q.cost, 10);
  });
});
