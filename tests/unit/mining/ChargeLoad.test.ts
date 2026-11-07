// BlastSimulator2026 — Unit tests: every charge load is bought at load time at list price (#2153)
//
// No warehouse stock exists: a load costs costPerKg x kg x the live explosive_price factor, paid from cash,
// booked once as an 'explosives' expense. Nothing here sets up, or can set up, a stock.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { getExplosive } from '../../../src/core/world/ExplosiveCatalog.js';
import {
  explosivePriceFactor, quoteChargeLoad, canAffordChargeLoad, loadChargeExplosive, isChargeUnaffordable,
} from '../../../src/core/mining/ChargeLoad.js';

const BOOMITE_LIST_PER_KG = 12;
const KRACKLE_LIST_PER_KG = 20;

function makeState(cash = 100_000): GameState {
  const state = createGame({ seed: 42, startingCash: cash });
  state.cash = cash;
  state.finances.cash = cash;
  return state;
}

function setCash(state: GameState, cash: number): void {
  state.cash = cash;
  state.finances.cash = cash;
}

/** A live event modifier scaling explosive prices by `magnitude` until `endTick` (null = permanent). */
function raisePrices(state: GameState, magnitude: number, endTick: number | null = null): void {
  state.events.activeModifiers.push({
    id: 1, kind: 'explosive_price', sourceEventId: 'test', role: null, targetId: null,
    category: null, magnitude, startTick: 0, endTick,
  });
}

const explosivesTx = (state: GameState) => state.finances.transactions.filter(t => t.category === 'explosives');

function chargeAction(payload: Record<string, unknown>, type: PendingAction['type'] = 'charge_hole'): Pick<PendingAction, 'type' | 'payload'> {
  return { type, payload };
}

describe('explosivePriceFactor', () => {
  it('is 1 with no live price modifiers', () => {
    expect(explosivePriceFactor(makeState())).toBe(1);
  });

  it('is the magnitude of a live explosive_price modifier', () => {
    const state = makeState();
    raisePrices(state, 1.5);
    expect(explosivePriceFactor(state)).toBeCloseTo(1.5, 10);
  });

  it('returns to 1 once the modifier has lapsed (boundary: endTick == tickCount)', () => {
    const state = makeState();
    state.tickCount = 50;
    raisePrices(state, 1.5, 50);
    expect(explosivePriceFactor(state)).toBe(1);
  });

  it('still applies one tick before the modifier lapses', () => {
    const state = makeState();
    state.tickCount = 49;
    raisePrices(state, 1.5, 50);
    expect(explosivePriceFactor(state)).toBeCloseTo(1.5, 10);
  });

  it('ignores modifiers of other kinds', () => {
    const state = makeState();
    state.events.activeModifiers.push({
      id: 2, kind: 'contract_price', sourceEventId: 'test', role: null, targetId: null,
      category: null, magnitude: 3, startTick: 0, endTick: null,
    });
    expect(explosivePriceFactor(state)).toBe(1);
  });
});

describe('quoteChargeLoad', () => {
  it('prices every kg at the catalog list price', () => {
    expect(quoteChargeLoad(makeState(), 'boomite', 5).cost).toBeCloseTo(5 * BOOMITE_LIST_PER_KG, 10);
    expect(quoteChargeLoad(makeState(), 'krackle', 5).cost).toBeCloseTo(5 * KRACKLE_LIST_PER_KG, 10);
  });

  it('is exactly costPerKg x kg for every catalog explosive', () => {
    for (const id of ['pop_rock', 'boomite', 'krackle', 'big_bada_boom']) {
      expect(quoteChargeLoad(makeState(), id, 7).cost, id).toBeCloseTo(getExplosive(id)!.costPerKg * 7, 10);
    }
  });

  it('scales linearly with kg', () => {
    const state = makeState();
    expect(quoteChargeLoad(state, 'boomite', 10).cost).toBeCloseTo(2 * quoteChargeLoad(state, 'boomite', 5).cost, 10);
  });

  it('multiplies by the live explosive_price factor', () => {
    const state = makeState();
    raisePrices(state, 1.5);
    expect(quoteChargeLoad(state, 'boomite', 5).cost).toBeCloseTo(5 * BOOMITE_LIST_PER_KG * 1.5, 10);
  });

  it('is not discounted by a bulk factor', () => {
    expect(quoteChargeLoad(makeState(), 'boomite', 100).cost).toBeCloseTo(1200, 10);
  });

  it('returns only a cost: there is no stock/cash split', () => {
    expect(Object.keys(quoteChargeLoad(makeState(), 'boomite', 5))).toEqual(['cost']);
  });

  it('reads nothing of the buildings: a state with no building data quotes the same', () => {
    const slim = { events: makeState().events, tickCount: 0 };
    expect(quoteChargeLoad(slim, 'boomite', 5).cost).toBeCloseTo(60, 10);
  });

  it('ignores whatever a legacy warehouse might hold', () => {
    const state = makeState();
    const withStock = {
      ...state,
      buildings: { buildings: [{ id: 1, type: 'explosive_warehouse', storedExplosives: { boomite: 1000 } }] },
    } as unknown as GameState;
    expect(quoteChargeLoad(withStock, 'boomite', 5).cost).toBeCloseTo(60, 10);
  });

  it('a zero-kg load costs 0', () => {
    expect(quoteChargeLoad(makeState(), 'boomite', 0).cost).toBe(0);
  });

  it('is pure: changes neither cash nor ledger', () => {
    const state = makeState();
    const cash = state.cash;
    quoteChargeLoad(state, 'boomite', 5);
    expect(state.cash).toBe(cash);
    expect(state.finances.transactions).toHaveLength(0);
  });
});

describe('canAffordChargeLoad', () => {
  it('is true when cash covers the cost', () => {
    expect(canAffordChargeLoad(makeState(1000), 'boomite', 5)).toBe(true);
  });

  it('is true when cash equals the cost exactly (boundary)', () => {
    const state = makeState();
    setCash(state, 5 * BOOMITE_LIST_PER_KG);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(true);
  });

  it('is false when cash is one cent short (rejection)', () => {
    const state = makeState();
    setCash(state, 5 * BOOMITE_LIST_PER_KG - 0.01);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(false);
  });

  it('is false with no cash for a non-zero load', () => {
    const state = makeState();
    setCash(state, 0);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(false);
  });

  it('is false with negative cash', () => {
    const state = makeState();
    setCash(state, -100);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(false);
  });

  it('a zero-cost load is affordable at zero cash', () => {
    const state = makeState();
    setCash(state, 0);
    expect(canAffordChargeLoad(state, 'boomite', 0)).toBe(true);
  });

  it('a zero-cost load is affordable even in debt', () => {
    const state = makeState();
    setCash(state, -500);
    expect(canAffordChargeLoad(state, 'boomite', 0)).toBe(true);
  });

  it('a price rise can turn an affordable load unaffordable', () => {
    const state = makeState();
    setCash(state, 5 * BOOMITE_LIST_PER_KG);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(true);
    raisePrices(state, 1.5);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(false);
  });

  it('a costlier explosive needs more cash', () => {
    const state = makeState();
    setCash(state, 5 * BOOMITE_LIST_PER_KG);
    expect(canAffordChargeLoad(state, 'boomite', 5)).toBe(true);
    expect(canAffordChargeLoad(state, 'krackle', 5)).toBe(false);
  });
});

describe('loadChargeExplosive', () => {
  it('deducts the list-price cost from cash and returns it', () => {
    const state = makeState(10_000);
    const r = loadChargeExplosive(state, 'boomite', 5);
    expect(r).toEqual({ cost: expect.closeTo(60, 10) });
    expect(state.cash).toBeCloseTo(10_000 - 60, 10);
  });

  it('books exactly one explosives expense of the cost', () => {
    const state = makeState(10_000);
    loadChargeExplosive(state, 'boomite', 5);
    const tx = explosivesTx(state);
    expect(tx).toHaveLength(1);
    expect(tx[0]!.amount).toBeCloseTo(60, 10);
    expect(tx[0]!.type).toBe('expense');
  });

  it('stamps the expense with the current tick', () => {
    const state = makeState(10_000);
    state.tickCount = 123;
    loadChargeExplosive(state, 'boomite', 5);
    expect(explosivesTx(state)[0]!.tick).toBe(123);
  });

  it('applies the live explosive_price factor', () => {
    const state = makeState(10_000);
    raisePrices(state, 1.5);
    const r = loadChargeExplosive(state, 'boomite', 5);
    expect(r.cost).toBeCloseTo(90, 10);
    expect(state.cash).toBeCloseTo(10_000 - 90, 10);
    expect(explosivesTx(state)[0]!.amount).toBeCloseTo(90, 10);
  });

  it('charges cash even when a legacy warehouse holds the explosive', () => {
    const state = makeState(10_000);
    const stocked = state as unknown as { buildings: { buildings: unknown[] } };
    stocked.buildings.buildings.push({ id: 99, type: 'explosive_warehouse', storedExplosives: { boomite: 1000 } });
    const r = loadChargeExplosive(state, 'boomite', 5);
    expect(r.cost).toBeCloseTo(60, 10);
    expect(state.cash).toBeCloseTo(10_000 - 60, 10);
    expect(explosivesTx(state)).toHaveLength(1);
  });

  it('a second load charges again, in full', () => {
    const state = makeState(10_000);
    loadChargeExplosive(state, 'boomite', 5);
    loadChargeExplosive(state, 'boomite', 5);
    expect(state.cash).toBeCloseTo(10_000 - 120, 10);
    expect(explosivesTx(state)).toHaveLength(2);
  });

  it('a zero-kg load books no expense and leaves cash alone (boundary)', () => {
    const state = makeState(10_000);
    const r = loadChargeExplosive(state, 'boomite', 0);
    expect(r.cost).toBe(0);
    expect(state.cash).toBe(10_000);
    expect(explosivesTx(state)).toHaveLength(0);
  });

  it('spends the exact cash on hand down to zero (boundary)', () => {
    const state = makeState();
    setCash(state, 60);
    loadChargeExplosive(state, 'boomite', 5);
    expect(state.cash).toBeCloseTo(0, 10);
  });
});

describe('isChargeUnaffordable', () => {
  it('is false when cash covers the order', () => {
    expect(isChargeUnaffordable(makeState(1000), chargeAction({ explosiveId: 'boomite', amountKg: 5 }))).toBe(false);
  });

  it('is true when cash is short of the order (rejection)', () => {
    const state = makeState();
    setCash(state, 59.99);
    expect(isChargeUnaffordable(state, chargeAction({ explosiveId: 'boomite', amountKg: 5 }))).toBe(true);
  });

  it('is false when cash equals the cost exactly (boundary)', () => {
    const state = makeState();
    setCash(state, 60);
    expect(isChargeUnaffordable(state, chargeAction({ explosiveId: 'boomite', amountKg: 5 }))).toBe(false);
  });

  it('is true at zero cash for a non-zero order', () => {
    const state = makeState();
    setCash(state, 0);
    expect(isChargeUnaffordable(state, chargeAction({ explosiveId: 'boomite', amountKg: 5 }))).toBe(true);
  });

  it('is false at zero cash for a zero-kg order', () => {
    const state = makeState();
    setCash(state, 0);
    expect(isChargeUnaffordable(state, chargeAction({ explosiveId: 'boomite', amountKg: 0 }))).toBe(false);
  });

  it('follows the live price factor', () => {
    const state = makeState();
    setCash(state, 60);
    raisePrices(state, 2);
    expect(isChargeUnaffordable(state, chargeAction({ explosiveId: 'boomite', amountKg: 5 }))).toBe(true);
  });

  it('is false for any other action type, even with no cash', () => {
    const state = makeState();
    setCash(state, 0);
    expect(isChargeUnaffordable(state, chargeAction({ explosiveId: 'boomite', amountKg: 5 }, 'drill_hole'))).toBe(false);
  });

  it('is false for a charge_hole payload missing its explosive or amount', () => {
    const state = makeState();
    setCash(state, 0);
    expect(isChargeUnaffordable(state, chargeAction({ amountKg: 5 }))).toBe(false);
    expect(isChargeUnaffordable(state, chargeAction({ explosiveId: 'boomite' }))).toBe(false);
    expect(isChargeUnaffordable(state, chargeAction({}))).toBe(false);
  });
});

describe('the stock machinery is gone (#2153)', () => {
  const exists = (rel: string) => existsSync(new URL(`../../../${rel}`, import.meta.url));

  it('ExplosiveStock.ts no longer exists; ChargeLoad.ts replaces it', () => {
    expect(exists('src/core/mining/' + 'ExplosiveStock.ts')).toBe(false);
    expect(exists('src/core/mining/ChargeLoad.ts')).toBe(true);
  });

  it('the secondary-blast modules no longer exist', () => {
    expect(exists('src/core/entities/' + 'SecondaryBlast.ts')).toBe(false);
    expect(exists('src/console/commands/mining/' + 'secondaryCrater.ts')).toBe(false);
  });

  it('Building exports no stock helper', async () => {
    const building = await import('../../../src/core/entities/Building.js');
    for (const name of ['storeExplosives', 'consumeExplosives', 'getExplosivesStockByType', 'getExplosivesInStock', 'warehouseStockKg']) {
      expect(name in building, name).toBe(false);
    }
  });

  it('balance exports none of the stock constants', async () => {
    const balance = await import('../../../src/core/config/balance.js');
    for (const name of [
      'EXPLOSIVE_BULK_PRICE_FACTOR', 'STOCK_BUY_STEP_KG', 'SANDBOX_STARTER_EXPLOSIVE_ID', 'SANDBOX_STARTER_EXPLOSIVE_KG',
    ]) {
      expect(name in balance, name).toBe(false);
    }
  });
});
