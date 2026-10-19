// Buyer tiers for progression-site contracts (#1929).
import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  BUYER_TIERS,
  unlockedBuyerTiers,
  pickBuyerTier,
  buyerSupplyQtyRange,
  buyerDeadlineRange,
  buyerPriceFactor,
  type BuyerTierId,
} from '../../../src/core/economy/BuyerTiers.js';
import { PRODUCTION_SUPPLY_QTY_KG } from '../../../src/core/config/balance.js';
import { t } from '../../../src/core/i18n/I18n.js';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

const IDS: BuyerTierId[] = ['local', 'regional', 'national', 'global'];
const SEEDS = Array.from({ length: 60 }, (_, i) => 500 + i);

function tier(id: BuyerTierId) {
  const found = BUYER_TIERS.find(b => b.id === id);
  if (!found) throw new Error(`missing tier ${id}`);
  return found;
}

describe('BUYER_TIERS table', () => {
  it('lists local, regional, national, global in order', () => {
    expect(BUYER_TIERS.map(b => b.id)).toEqual(IDS);
  });

  it('unlock grades are 0, 1, 3, 5', () => {
    expect(BUYER_TIERS.map(b => b.unlockGrade)).toEqual([0, 1, 3, 5]);
  });

  it('ore-sale quantity ranges and steps follow the spec', () => {
    expect(tier('local').oreSaleQtyKg).toEqual({ min: 100, max: 1000 });
    expect(tier('local').stepKg).toBe(100);
    expect(tier('regional').oreSaleQtyKg).toEqual({ min: 1000, max: 5000 });
    expect(tier('regional').stepKg).toBe(250);
    expect(tier('national').oreSaleQtyKg).toEqual({ min: 10_000, max: 40_000 });
    expect(tier('national').stepKg).toBe(1000);
    expect(tier('global').oreSaleQtyKg).toEqual({ min: 50_000, max: 250_000 });
    expect(tier('global').stepKg).toBe(5000);
  });

  it('price factors follow the spec', () => {
    expect(tier('local').priceFactor).toEqual({ min: 1.15, max: 1.30 });
    expect(tier('regional').priceFactor).toEqual({ min: 0.95, max: 1.10 });
    expect(tier('national').priceFactor).toEqual({ min: 0.85, max: 1.00 });
    expect(tier('global').priceFactor).toEqual({ min: 0.75, max: 0.95 });
  });

  it('supply factors are 0.5, 1, 6, 25', () => {
    expect(BUYER_TIERS.map(b => b.supplyQtyFactor)).toEqual([0.5, 1, 6, 25]);
  });

  it('weights are 0.35, 0.35, 0.2, 0.1', () => {
    expect(BUYER_TIERS.map(b => b.weight)).toEqual([0.35, 0.35, 0.2, 0.1]);
  });

  it('every tier carries a positive reference haul rate and an i18n name key', () => {
    for (const b of BUYER_TIERS) {
      expect(b.refHaulKgPerTick).toBeGreaterThan(0);
      expect(b.nameKey).toBe(`economy.buyer.${b.id}`);
    }
  });
});

describe('unlockedBuyerTiers', () => {
  const idsAt = (g: number) => unlockedBuyerTiers(g).map(b => b.id);

  it('grade 0 unlocks only local', () => {
    expect(idsAt(0)).toEqual(['local']);
  });

  it('grades 1 and 2 add regional', () => {
    expect(idsAt(1)).toEqual(['local', 'regional']);
    expect(idsAt(2)).toEqual(['local', 'regional']);
  });

  it('grades 3 and 4 add national', () => {
    expect(idsAt(3)).toEqual(['local', 'regional', 'national']);
    expect(idsAt(4)).toEqual(['local', 'regional', 'national']);
  });

  it('grade 5 and above unlock everything', () => {
    expect(idsAt(5)).toEqual(IDS);
    expect(idsAt(6)).toEqual(IDS);
    expect(idsAt(40)).toEqual(IDS);
  });
});

describe('pickBuyerTier', () => {
  it('grade 0 always picks local', () => {
    const rng = new Random(42);
    for (let i = 0; i < 200; i++) expect(pickBuyerTier(rng, 0).id).toBe('local');
  });

  it('never picks a locked tier', () => {
    const rng = new Random(7);
    for (let i = 0; i < 500; i++) {
      expect(['local', 'regional']).toContain(pickBuyerTier(rng, 2).id);
      expect(['local', 'regional', 'national']).toContain(pickBuyerTier(rng, 4).id);
    }
  });

  it('grade 1 splits roughly 50/50 between local and regional', () => {
    const rng = new Random(42);
    let local = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (pickBuyerTier(rng, 1).id === 'local') local++;
    expect(local / n).toBeGreaterThan(0.45);
    expect(local / n).toBeLessThan(0.55);
  });

  it('grade 5 follows the renormalized weights and reaches every tier', () => {
    const rng = new Random(99);
    const counts: Record<string, number> = { local: 0, regional: 0, national: 0, global: 0 };
    const n = 8000;
    for (let i = 0; i < n; i++) counts[pickBuyerTier(rng, 5).id]!++;
    expect(counts.local! / n).toBeGreaterThan(0.31);
    expect(counts.local! / n).toBeLessThan(0.39);
    expect(counts.national! / n).toBeGreaterThan(0.16);
    expect(counts.national! / n).toBeLessThan(0.24);
    expect(counts.global! / n).toBeGreaterThan(0.07);
    expect(counts.global! / n).toBeLessThan(0.13);
  });

  it('consumes exactly one nextFloat draw per pick, also at grade 0', () => {
    for (const g of [0, 1, 5]) {
      const a = new Random(11);
      const b = new Random(11);
      pickBuyerTier(a, g);
      b.nextFloat(0, 1);
      expect(a.nextFloat(0, 1)).toBe(b.nextFloat(0, 1));
    }
  });

  it('is deterministic for a seed', () => {
    const run = () => { const r = new Random(3); return Array.from({ length: 30 }, () => pickBuyerTier(r, 5).id); };
    expect(run()).toEqual(run());
  });
});

describe('buyerSupplyQtyRange', () => {
  it('scales the base range by the tier factor', () => {
    expect(buyerSupplyQtyRange(tier('local'), PRODUCTION_SUPPLY_QTY_KG)).toEqual({ min: 2000, max: 4000 });
    expect(buyerSupplyQtyRange(tier('regional'), PRODUCTION_SUPPLY_QTY_KG)).toEqual({ min: 4000, max: 8000 });
    expect(buyerSupplyQtyRange(tier('national'), PRODUCTION_SUPPLY_QTY_KG)).toEqual({ min: 24_000, max: 48_000 });
    expect(buyerSupplyQtyRange(tier('global'), PRODUCTION_SUPPLY_QTY_KG)).toEqual({ min: 100_000, max: 200_000 });
  });

  it('boundary: a zero base stays zero', () => {
    expect(buyerSupplyQtyRange(tier('global'), { min: 0, max: 0 })).toEqual({ min: 0, max: 0 });
  });
});

describe('buyerDeadlineRange', () => {
  it('lets refRate haul 1.5x maxQty by the shortest deadline', () => {
    const range = buyerDeadlineRange(8000, 31);
    expect(range.min).toBeGreaterThanOrEqual((1.5 * 8000) / 31 - 1e-9);
    expect(range.max).toBeGreaterThan(range.min);
  });

  it('scales with quantity and shrinks with a faster haul rate', () => {
    expect(buyerDeadlineRange(16_000, 31).min).toBeGreaterThan(buyerDeadlineRange(8000, 31).min);
    expect(buyerDeadlineRange(8000, 62).min).toBeLessThan(buyerDeadlineRange(8000, 31).min);
  });
});

describe('buyerPriceFactor', () => {
  it('ore-sale factor stays inside the tier price range', () => {
    const rng = new Random(5);
    for (const b of BUYER_TIERS) {
      for (let i = 0; i < 100; i++) {
        const f = buyerPriceFactor(b, 'ore_sale', rng);
        expect(f).toBeGreaterThanOrEqual(b.priceFactor.min - 1e-9);
        expect(f).toBeLessThanOrEqual(b.priceFactor.max + 1e-9);
      }
    }
  });

  it('supply factor is the ore-factor roll times 0.75', () => {
    for (const b of BUYER_TIERS) {
      const rng = new Random(21);
      for (let i = 0; i < 100; i++) {
        const f = buyerPriceFactor(b, 'supply', rng);
        expect(f).toBeGreaterThanOrEqual(b.priceFactor.min * 0.75 - 1e-9);
        expect(f).toBeLessThanOrEqual(b.priceFactor.max * 0.75 + 1e-9);
      }
    }
  });

  it('supply and ore-sale rolls from the same seed differ by exactly 0.75', () => {
    const b = tier('regional');
    expect(buyerPriceFactor(b, 'supply', new Random(8))).toBeCloseTo(buyerPriceFactor(b, 'ore_sale', new Random(8)) * 0.75, 9);
  });
});

describe('deadline invariant: the reference haul rate can fill 1.5x any offer in time', () => {
  for (const id of IDS) {
    for (const kind of ['ore_sale', 'supply'] as const) {
      it(`${id} ${kind}`, () => {
        const b = tier(id);
        const qty = kind === 'ore_sale' ? b.oreSaleQtyKg : buyerSupplyQtyRange(b, PRODUCTION_SUPPLY_QTY_KG);
        const dl = buyerDeadlineRange(qty.max, b.refHaulKgPerTick);
        for (const seed of SEEDS) {
          const rng = new Random(seed);
          const q = Math.round(rng.nextFloat(qty.min, qty.max) / b.stepKg) * b.stepKg;
          const d = rng.nextInt(dl.min, dl.max);
          expect(1.5 * q).toBeLessThanOrEqual(b.refHaulKgPerTick * d + 1e-6);
        }
      });
    }
  }
});

describe('buyer tier i18n', () => {
  const en = enLocale as Record<string, string>;
  const fr = frLocale as Record<string, string>;

  it('en and fr define economy.buyer.<tier> for every tier', () => {
    for (const id of IDS) {
      const key = `economy.buyer.${id}`;
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(fr[key], `fr ${key}`).toBeTruthy();
      expect(t(key)).toBe(en[key]);
    }
  });

  it('unlock lines for the buyer tiers have keys in both locales', () => {
    for (const id of ['regional', 'national', 'global']) {
      const key = `progression.unlock.buyer.${id}`;
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(fr[key], `fr ${key}`).toBeTruthy();
    }
  });
});
