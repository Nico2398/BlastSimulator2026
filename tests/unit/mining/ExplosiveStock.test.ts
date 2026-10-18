// BlastSimulator2026 — Unit tests: bulk explosive stock, pure helpers and purchase (#1678)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { placeBuilding, getBuildingDef } from '../../../src/core/entities/Building.js';
import { getExplosivesInStock } from '../../../src/core/entities/BuildingWarehouse.js';
import { getExplosive } from '../../../src/core/world/ExplosiveCatalog.js';
import { EXPLOSIVE_BULK_PRICE_FACTOR, EXPLOSIVE_DELIVERY_TICKS } from '../../../src/core/config/balance.js';
import {
  bulkPricePerKg, drawStockForOrder, buyExplosiveStock, returnOrderStock, explosivePriceFactor, buyStockBlockReason,
  orderDeliveryTicks, readOrderDeliveryTick, isChargeDeliveryPending, chargeDeliveryArrivalByHole,
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

describe('orderDeliveryTicks (#1895)', () => {
  it('is 0 when nothing is bought with cash', () => {
    expect(orderDeliveryTicks(0)).toBe(0);
  });

  it('is the flat delivery wait for any positive cash-bought kg, however small', () => {
    expect(orderDeliveryTicks(0.001)).toBe(EXPLOSIVE_DELIVERY_TICKS);
    expect(orderDeliveryTicks(1)).toBe(EXPLOSIVE_DELIVERY_TICKS);
  });

  it('is flat: a huge order waits no longer than a small one', () => {
    expect(orderDeliveryTicks(10_000)).toBe(orderDeliveryTicks(1));
  });

  it('is 0 for a negative amount', () => {
    expect(orderDeliveryTicks(-5)).toBe(0);
  });
});

describe('readOrderDeliveryTick (#1895)', () => {
  it('reads the arrival tick from the payload', () => {
    expect(readOrderDeliveryTick({ payload: { deliveryArrivalTick: 450 } })).toBe(450);
  });

  it('is undefined when the payload has no arrival tick', () => {
    expect(readOrderDeliveryTick({ payload: {} })).toBeUndefined();
  });

  it('is undefined for a non-numeric payload value', () => {
    expect(readOrderDeliveryTick({ payload: { deliveryArrivalTick: 'soon' } })).toBeUndefined();
  });
});

describe('isChargeDeliveryPending (#1895)', () => {
  const charge = { type: 'charge_hole', payload: { deliveryArrivalTick: 450 } } as const;

  it('is true before the arrival tick, false from it on', () => {
    expect(isChargeDeliveryPending(charge, 449)).toBe(true);
    expect(isChargeDeliveryPending(charge, 450)).toBe(false);
  });

  it('is false without an arrival tick or for other action types', () => {
    expect(isChargeDeliveryPending({ type: 'charge_hole', payload: {} }, 0)).toBe(false);
    expect(isChargeDeliveryPending({ type: 'drill_hole', payload: { deliveryArrivalTick: 450 } }, 0)).toBe(false);
  });
});

describe('chargeDeliveryArrivalByHole (#1966)', () => {
  function order(id: number, payload: Record<string, unknown>, type = 'charge_hole'): GameState['pendingActions'][number] {
    return { id, type, payload } as unknown as GameState['pendingActions'][number];
  }

  it('maps each hole with an in-transit charge order to its arrival tick', () => {
    const map = chargeDeliveryArrivalByHole({
      tickCount: 100,
      pendingActions: [order(1, { holeId: 'H1', deliveryArrivalTick: 500 }), order(2, { holeId: 'H2', deliveryArrivalTick: 520 })],
    });
    expect(map.get('H1')).toBe(500);
    expect(map.get('H2')).toBe(520);
    expect(map.size).toBe(2);
  });

  it('is empty with no pending actions', () => {
    expect(chargeDeliveryArrivalByHole({ tickCount: 0, pendingActions: [] }).size).toBe(0);
  });

  it('ignores an order whose delivery already arrived', () => {
    const map = chargeDeliveryArrivalByHole({
      tickCount: 500,
      pendingActions: [order(1, { holeId: 'H1', deliveryArrivalTick: 500 }), order(2, { holeId: 'H2', deliveryArrivalTick: 501 })],
    });
    expect(map.has('H1')).toBe(false);
    expect(map.get('H2')).toBe(501);
  });

  it('ignores an order without an arrival tick (stock-covered) and non-charge actions', () => {
    const map = chargeDeliveryArrivalByHole({
      tickCount: 0,
      pendingActions: [order(1, { holeId: 'H1' }), order(2, { holeId: 'H2', deliveryArrivalTick: 400 }, 'drill_hole')],
    });
    expect(map.size).toBe(0);
  });

  it('ignores an order without a holeId', () => {
    const map = chargeDeliveryArrivalByHole({ tickCount: 0, pendingActions: [order(1, { deliveryArrivalTick: 400 })] });
    expect(map.size).toBe(0);
  });
});
