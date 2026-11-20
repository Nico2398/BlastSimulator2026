import { describe, it, expect } from 'vitest';
import {
  BUYER_DEADLINE_MARGIN,
  BUYER_DEADLINE_SPAN_RATIO,
  BUYER_ORE_SALE_QTY_KG,
  BUYER_REF_HAUL_KG_PER_TICK,
  BUYER_SUPPLY_QTY_FACTOR,
  BUYER_UNLOCK_GRADE,
  PRODUCTION_SUPPLY_QTY_KG,
  MINE_GRADES,
  ORE_GRADE_SCALE_MAX,
  PERMIT_LIMITS,
  SANDBOX_ORE_GRADE_SCALE,
} from '../../../src/core/config/balance.js';
import { buyerDeadlineRange } from '../../../src/core/economy/BuyerTiers.js';

/** Ladder steps of the permit table, keyed by rung (grade x 3 + tier - 1). */
const RUNGS = Array.from({ length: 12 }, (_, i) => i);
const NAMED = [0, 1, 2, 3];
/** Every tier target of the named grades in ladder order, then each grade's mastery after its tiers. */
const tierValues = (g: number, kind: string): number[] =>
  MINE_GRADES[g]!.tiers.flatMap(x => x.targets.filter(tg => tg.kind === kind).map(tg => tg.value));

describe('progression balance invariants (#1945, #2277)', () => {
  it('grade fees strictly increase across grades 1-3', () => {
    for (let g = 2; g <= 3; g++) expect(MINE_GRADES[g]!.fee).toBeGreaterThan(MINE_GRADES[g - 1]!.fee);
  });

  it('ore_kg targets strictly increase tier after tier and grade after grade, mastery included', () => {
    let prev = 0;
    for (const g of NAMED) {
      for (const v of tierValues(g, 'ore_kg')) {
        expect(v).toBeGreaterThan(prev);
        prev = v;
      }
      const mastery = MINE_GRADES[g]!.mastery.find(tg => tg.kind === 'ore_kg')!.value;
      expect(mastery).toBeGreaterThan(prev);
      prev = mastery;
    }
  });

  it('depth_m targets strictly increase wherever a tier asks one', () => {
    const all = NAMED.flatMap(g => tierValues(g, 'depth_m'));
    expect(all.length).toBeGreaterThan(3);
    for (let i = 1; i < all.length; i++) expect(all[i]!).toBeGreaterThan(all[i - 1]!);
  });

  it('the permit table has one entry per ladder step 0-11', () => {
    expect(Object.keys(PERMIT_LIMITS).map(Number).sort((a, b) => a - b)).toEqual(RUNGS);
  });

  it('permit charge and area limits strictly increase across the ladder steps', () => {
    for (const r of RUNGS.slice(1)) {
      expect(PERMIT_LIMITS[r]!.maxChargeKg).toBeGreaterThan(PERMIT_LIMITS[r - 1]!.maxChargeKg);
      expect(PERMIT_LIMITS[r]!.maxAreaM2).toBeGreaterThan(PERMIT_LIMITS[r - 1]!.maxAreaM2);
    }
  });

  it('keeps the ore grade scale levers where calibration left them', () => {
    expect(SANDBOX_ORE_GRADE_SCALE).toBe(0.08);
    expect(ORE_GRADE_SCALE_MAX).toBe(1);
  });

  it('permit filing fees strictly increase across the ladder steps', () => {
    for (const r of RUNGS.slice(1)) expect(PERMIT_LIMITS[r]!.fee).toBeGreaterThan(PERMIT_LIMITS[r - 1]!.fee);
  });

  describe('buyer tiers (#2066)', () => {
    const tiers = ['local', 'regional', 'national', 'global'] as const;

    it('every tier has a positive reference haul rate and a margin of at least 1', () => {
      expect(BUYER_DEADLINE_MARGIN).toBeGreaterThanOrEqual(1);
      expect(BUYER_DEADLINE_SPAN_RATIO).toBeGreaterThan(1);
      for (const t of tiers) expect(BUYER_REF_HAUL_KG_PER_TICK[t]).toBeGreaterThan(0);
    });

    it('the shortest deadline lets the reference rate haul the biggest lot with margin', () => {
      for (const t of tiers) {
        const qtyMax = Math.max(BUYER_ORE_SALE_QTY_KG[t].max, PRODUCTION_SUPPLY_QTY_KG.max * BUYER_SUPPLY_QTY_FACTOR[t]);
        const rate = BUYER_REF_HAUL_KG_PER_TICK[t];
        const range = buyerDeadlineRange(qtyMax, rate);
        expect(rate * range.min).toBeGreaterThanOrEqual(qtyMax * BUYER_DEADLINE_MARGIN);
        expect(range.max).toBeGreaterThan(range.min);
      }
    });

    it('lot sizes, supply factors, haul rates and unlock grades never shrink with tier', () => {
      for (let i = 1; i < tiers.length; i++) {
        const a = tiers[i - 1]!, b = tiers[i]!;
        expect(BUYER_ORE_SALE_QTY_KG[b].max).toBeGreaterThan(BUYER_ORE_SALE_QTY_KG[a].max);
        expect(BUYER_SUPPLY_QTY_FACTOR[b]).toBeGreaterThan(BUYER_SUPPLY_QTY_FACTOR[a]);
        expect(BUYER_REF_HAUL_KG_PER_TICK[b]).toBeGreaterThanOrEqual(BUYER_REF_HAUL_KG_PER_TICK[a]);
        expect(BUYER_UNLOCK_GRADE[b]).toBeGreaterThanOrEqual(BUYER_UNLOCK_GRADE[a]);
      }
      for (const t of tiers) expect(BUYER_ORE_SALE_QTY_KG[t].max).toBeGreaterThan(BUYER_ORE_SALE_QTY_KG[t].min);
    });
  });
});
