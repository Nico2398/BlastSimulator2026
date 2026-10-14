// BlastSimulator2026 — Market profiles (#1681)

import { describe, it, expect } from 'vitest';
import {
  resolveMarket,
  oreValuePerKg,
  oreContractBasePrice,
} from '../../../src/core/economy/Market.js';
import { getAllOres, getOre } from '../../../src/core/world/OreCatalog.js';
import { ORE_PRICES, PRODUCTION_ORE_PRICES, RUBBLE_DISPOSAL_PRICE_RANGE } from '../../../src/core/config/balance.js';

const ORE_IDS = Object.keys(ORE_PRICES);

describe('legacy market', () => {
  it('values every ore at its catalog valuePerKg', () => {
    for (const ore of getAllOres()) expect(oreValuePerKg(ore.id, 'legacy')).toBe(getOre(ore.id)!.valuePerKg);
  });

  it('contracts every ore at the existing ORE_PRICES base', () => {
    for (const id of ORE_IDS) expect(oreContractBasePrice(id, 'legacy')).toBe(ORE_PRICES[id as keyof typeof ORE_PRICES]);
  });

  it('an undefined market behaves as legacy', () => {
    for (const id of ORE_IDS) {
      expect(oreValuePerKg(id)).toBe(oreValuePerKg(id, 'legacy'));
      expect(oreContractBasePrice(id)).toBe(oreContractBasePrice(id, 'legacy'));
    }
    expect(resolveMarket(undefined)).toBe(resolveMarket('legacy'));
  });

  it('keeps the offer volumes and rubble prices of today (50-500 kg, step 10)', () => {
    const p = resolveMarket('legacy');
    expect(p.oreSaleQtyKg).toEqual({ min: 50, max: 500 });
    expect(p.qtyStepKg).toBe(10);
    expect(p.rubblePricePerKg).toEqual({ min: RUBBLE_DISPOSAL_PRICE_RANGE.min, max: RUBBLE_DISPOSAL_PRICE_RANGE.max });
  });

  it('an unknown ore falls back to the legacy contract default of 10', () => {
    expect(oreContractBasePrice('nonsense', 'legacy')).toBe(10);
  });
});

describe('production market', () => {
  it('is a distinct profile registered for both ids', () => {
    expect(resolveMarket('production')).toBeDefined();
    expect(resolveMarket('production')).not.toBe(resolveMarket('legacy'));
    expect(resolveMarket('production')).toBe(resolveMarket('production'));
  });

  it('prices every ore from PRODUCTION_ORE_PRICES, equal for value and contract base', () => {
    for (const id of ORE_IDS) {
      expect(PRODUCTION_ORE_PRICES[id], id).toBeGreaterThan(0);
      expect(oreValuePerKg(id, 'production'), id).toBe(PRODUCTION_ORE_PRICES[id]);
      expect(oreContractBasePrice(id, 'production'), id).toBe(PRODUCTION_ORE_PRICES[id]);
    }
  });

  it('price ladder is monotone in rarity order and spans at most ~16x', () => {
    const prices = ORE_IDS.map((id) => oreValuePerKg(id, 'production'));
    for (let i = 1; i < prices.length; i++) expect(prices[i]!, ORE_IDS[i]).toBeGreaterThanOrEqual(prices[i - 1]!);
    expect(Math.max(...prices) / Math.min(...prices)).toBeLessThanOrEqual(16.5);
    expect(Math.max(...prices)).toBeGreaterThan(Math.min(...prices));
  });

  it('is far cheaper than the legacy catalog for every ore', () => {
    for (const id of ORE_IDS) expect(oreValuePerKg(id, 'production')).toBeLessThan(oreValuePerKg(id, 'legacy'));
  });

  it('an unknown ore falls back to the cheapest ore (dirtite) price', () => {
    expect(oreValuePerKg('nonsense', 'production')).toBe(oreValuePerKg('dirtite', 'production'));
    expect(oreContractBasePrice('nonsense', 'production')).toBe(oreContractBasePrice('dirtite', 'production'));
  });

  it('has well-formed ranges: min <= max, positive, step divides the quantities', () => {
    const p = resolveMarket('production');
    for (const r of [p.oreSaleQtyKg, p.supplyQtyKg, p.rubbleQtyKg, p.oreSalePriceFactor, p.supplyPriceFactor, p.rubblePricePerKg]) {
      expect(r.min).toBeGreaterThan(0);
      expect(r.max).toBeGreaterThanOrEqual(r.min);
    }
    expect(p.qtyStepKg).toBeGreaterThan(0);
    for (const r of [p.oreSaleQtyKg, p.supplyQtyKg, p.rubbleQtyKg]) {
      expect(r.min % p.qtyStepKg).toBe(0);
      expect(r.max % p.qtyStepKg).toBe(0);
    }
  });

  it('offers far bigger volumes than legacy: ore sales and rubble', () => {
    const prod = resolveMarket('production');
    const legacy = resolveMarket('legacy');
    expect(prod.oreSaleQtyKg.max).toBeGreaterThan(legacy.oreSaleQtyKg.max * 3);
    expect(prod.rubbleQtyKg.max).toBeGreaterThan(legacy.rubbleQtyKg.max * 10);
  });
});
