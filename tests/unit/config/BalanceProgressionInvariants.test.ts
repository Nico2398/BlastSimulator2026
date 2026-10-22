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
import { SHOT } from '../../../scripts/shared/probe-strategies.js';
import { GRADE_TARGET_WINDOWS, limitSizedShot } from '../../../scripts/shared/probe-ladder.js';

const GRADES = [1, 2, 3, 4, 5];
const target = (g: number, kind: string) => MINE_GRADES[g]!.targets.find(t => t.kind === kind)?.value;

describe('progression balance invariants (#1945)', () => {
  it('grade fees strictly increase across grades 1-5', () => {
    for (let g = 2; g <= 5; g++) expect(MINE_GRADES[g]!.fee).toBeGreaterThan(MINE_GRADES[g - 1]!.fee);
  });

  it('ore_kg targets strictly increase across grades 1-5', () => {
    for (let g = 2; g <= 5; g++) expect(target(g, 'ore_kg')!).toBeGreaterThan(target(g - 1, 'ore_kg')!);
  });

  it('depth_m targets strictly increase across grades 2-5', () => {
    for (let g = 3; g <= 5; g++) expect(target(g, 'depth_m')!).toBeGreaterThan(target(g - 1, 'depth_m')!);
  });

  it('permit charge and hole limits strictly increase across grades 0-5', () => {
    for (let g = 1; g <= 5; g++) {
      expect(PERMIT_LIMITS[g]!.maxChargeKg).toBeGreaterThan(PERMIT_LIMITS[g - 1]!.maxChargeKg);
      expect(PERMIT_LIMITS[g]!.maxHoles).toBeGreaterThan(PERMIT_LIMITS[g - 1]!.maxHoles);
    }
  });

  it('the grade-1 reference shot fits the grade-1 permit', () => {
    const limit = PERMIT_LIMITS[1]!;
    expect(SHOT.rows * SHOT.cols * SHOT.kg).toBeLessThanOrEqual(limit.maxChargeKg);
    expect(SHOT.rows * SHOT.cols).toBeLessThanOrEqual(limit.maxHoles);
  });

  it('the ladder shot grows with the permit yet stays inside it for grades 1-5', () => {
    const base = { rows: SHOT.rows, cols: SHOT.cols, spacing: SHOT.spacing, depth: SHOT.depth,
      kgPerHole: SHOT.kg, stemming: SHOT.stemming, diameterM: 0.089 };
    for (const g of GRADES) {
      const s = limitSizedShot(PERMIT_LIMITS[g]!, base, 0.165);
      expect(s.rows * s.cols).toBeLessThanOrEqual(PERMIT_LIMITS[g]!.maxHoles);
      expect(s.rows * s.cols * s.kgPerHole).toBeLessThanOrEqual(PERMIT_LIMITS[g]!.maxChargeKg + 1e-9);
    }
    const g1 = limitSizedShot(PERMIT_LIMITS[1]!, base, 0.165);
    const g5 = limitSizedShot(PERMIT_LIMITS[5]!, base, 0.165);
    expect(g5.rows * g5.cols).toBeGreaterThan(g1.rows * g1.cols);
  });

  it('keeps the ore grade scale levers where calibration left them', () => {
    expect(SANDBOX_ORE_GRADE_SCALE).toBe(0.08);
    expect(ORE_GRADE_SCALE_MAX).toBe(1);
  });

  it('permit filing fees strictly increase across grades 0-5', () => {
    for (let g = 1; g <= 5; g++) expect(PERMIT_LIMITS[g]!.fee).toBeGreaterThan(PERMIT_LIMITS[g - 1]!.fee);
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

  it('grade target windows are well-formed, ordered and non-overlapping (g3 < g4 < g5)', () => {
    for (const g of [3, 4, 5]) {
      const [lo, hi] = GRADE_TARGET_WINDOWS[g]!;
      expect(lo).toBeGreaterThan(0);
      expect(hi).toBeGreaterThan(lo);
    }
    expect(GRADE_TARGET_WINDOWS[3]![1]).toBeLessThanOrEqual(GRADE_TARGET_WINDOWS[4]![0]);
    expect(GRADE_TARGET_WINDOWS[4]![1]).toBeLessThanOrEqual(GRADE_TARGET_WINDOWS[5]![0]);
  });
});
