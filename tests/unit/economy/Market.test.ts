// BlastSimulator2026 — Market profiles (#1681)

import { describe, it, expect } from 'vitest';
import {
  resolveMarket,
  oreValuePerKg,
  oreContractBasePrice,
} from '../../../src/core/economy/Market.js';
import { getAllOres, getOre } from '../../../src/core/world/OreCatalog.js';
import { ORE_PRICES, PRODUCTION_ORE_PRICES, RUBBLE_DISPOSAL_PRICE_RANGE, SHAREHOLDER_SUMMIT_CONTRACT_PRICE_MULTIPLIER } from '../../../src/core/config/balance.js';

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

  it('flattens the legacy catalog: the common ore pays more, the rarest far less', () => {
    const first = ORE_IDS[0]!;
    const last = ORE_IDS[ORE_IDS.length - 1]!;
    expect(oreValuePerKg(first, 'production')).toBeGreaterThan(oreValuePerKg(first, 'legacy'));
    expect(oreValuePerKg(last, 'production')).toBeLessThan(oreValuePerKg(last, 'legacy'));
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

/** The production table before #2117, literally. */
const OLD_PRODUCTION_PRICES: Record<string, number> = {
  dirtite: 105,
  rustite: 192.5,
  blingite: 297.5,
  gloomium: 420,
  sparkium: 595,
  craktonite: 840,
  absurdium: 1172.5,
  treranium: 1680,
};

describe('production ore prices after the 0.6 cut (#2117)', () => {
  const NEW_PRICES: Record<string, number> = {
    dirtite: 63,
    rustite: 115.5,
    blingite: 178.5,
    gloomium: 252,
    sparkium: 357,
    craktonite: 504,
    absurdium: 703.5,
    treranium: 1008,
  };

  it('prices each ore at 0.6 of the previous table', () => {
    for (const [id, price] of Object.entries(NEW_PRICES)) {
      expect(PRODUCTION_ORE_PRICES[id], id).toBeCloseTo(price, 6);
      expect(PRODUCTION_ORE_PRICES[id], id).toBeCloseTo(OLD_PRODUCTION_PRICES[id]! * 0.6, 6);
    }
  });

  it('prices exactly the same eight ores', () => {
    expect(Object.keys(PRODUCTION_ORE_PRICES).sort()).toEqual(Object.keys(NEW_PRICES).sort());
  });

  it('the production market sells and contracts at the cut prices', () => {
    for (const [id, price] of Object.entries(NEW_PRICES)) {
      expect(oreValuePerKg(id, 'production'), id).toBeCloseTo(price, 6);
      expect(oreContractBasePrice(id, 'production'), id).toBeCloseTo(price, 6);
    }
  });

  it('keeps the rarity order and the ratios between ores', () => {
    const ids = Object.keys(NEW_PRICES);
    for (let i = 1; i < ids.length; i++) {
      const [a, b] = [ids[i - 1]!, ids[i]!];
      expect(PRODUCTION_ORE_PRICES[b]!).toBeGreaterThan(PRODUCTION_ORE_PRICES[a]!);
      expect(PRODUCTION_ORE_PRICES[b]! / PRODUCTION_ORE_PRICES[a]!).toBeCloseTo(OLD_PRODUCTION_PRICES[b]! / OLD_PRODUCTION_PRICES[a]!, 6);
    }
  });

  it('an unknown ore still falls back to the cheapest ore, now 63', () => {
    expect(oreValuePerKg('nonsense', 'production')).toBeCloseTo(63, 6);
  });

  it('leaves the legacy catalog untouched', () => {
    expect(oreContractBasePrice('nonsense', 'legacy')).toBe(10);
  });
});

describe('Shareholder Summit contract prices (#2117)', () => {
  it('multiplier compensates the cut: 1.5 / 0.6 = 2.5', () => {
    expect(SHAREHOLDER_SUMMIT_CONTRACT_PRICE_MULTIPLIER).toBeCloseTo(2.5, 9);
  });

  it('pays per ore what the old table paid at 1.5x', () => {
    for (const [id, oldPrice] of Object.entries(OLD_PRODUCTION_PRICES)) {
      const effective = oreContractBasePrice(id, 'production') * SHAREHOLDER_SUMMIT_CONTRACT_PRICE_MULTIPLIER;
      expect(effective, id).toBeCloseTo(oldPrice * 1.5, 6);
    }
  });

  it('spot price of the cheapest ore at the summit multiplier equals 105 x 1.5', () => {
    expect(oreContractBasePrice('dirtite', 'production') * SHAREHOLDER_SUMMIT_CONTRACT_PRICE_MULTIPLIER).toBeCloseTo(157.5, 6);
  });
});
