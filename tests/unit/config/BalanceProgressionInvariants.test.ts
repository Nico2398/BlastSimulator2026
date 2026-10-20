import { describe, it, expect } from 'vitest';
import {
  MINE_GRADES,
  ORE_GRADE_SCALE_MAX,
  PERMIT_LIMITS,
  SANDBOX_ORE_GRADE_SCALE,
} from '../../../src/core/config/balance.js';
import { SHOT } from '../../../scripts/shared/probe-strategies.js';
import { limitSizedShot } from '../../../scripts/shared/probe-ladder.js';

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
});
