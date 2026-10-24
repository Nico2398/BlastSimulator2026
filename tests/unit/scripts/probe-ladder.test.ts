import { describe, it, expect } from 'vitest';
import {
  GRADE_TARGET_WINDOWS,
  gradeVerdicts,
  limitSizedShot,
  mayBuyVehicleTier,
  nextBuy,
  pickDiameter,
  shouldApplyPermit,
  shouldBench,
} from '../../../scripts/shared/probe-ladder.js';
import type { BuyRule, LadderShot } from '../../../scripts/shared/probe-ladder.js';
import {
  DRILL_HOLE_DIAMETER_OPTIONS_M,
  PERMIT_LIMITS,
  VEHICLE_TIER_UNLOCK_GRADE,
} from '../../../src/core/config/balance.js';

const BASE: LadderShot = { rows: 3, cols: 3, spacing: 4, depth: 5, kgPerHole: 4, stemming: 2.5, diameterM: 0.089 };
const WIDE = 0.165;

describe('limitSizedShot', () => {
  for (const grade of [0, 1, 2, 3, 4, 5]) {
    it(`grade ${grade}: never exceeds the permit charge or hole limit`, () => {
      const limit = PERMIT_LIMITS[grade]!;
      const shot = limitSizedShot(limit, BASE, WIDE);
      expect(shot.rows * shot.cols).toBeLessThanOrEqual(limit.maxHoles);
      expect(shot.rows * shot.cols * shot.kgPerHole).toBeLessThanOrEqual(limit.maxChargeKg + 1e-9);
      expect(shot.rows).toBe(shot.cols);
      expect(shot.rows).toBeGreaterThanOrEqual(1);
      expect(shot.kgPerHole).toBeGreaterThan(0);
    });
  }

  it('grade 0 keeps the reinvest SHOT shape (3x3, 36 kg <= 40)', () => {
    const shot = limitSizedShot(PERMIT_LIMITS[0]!, BASE, 0.089);
    expect(shot.rows).toBe(3);
    expect(shot.cols).toBe(3);
    expect(shot.rows * shot.cols * shot.kgPerHole).toBeLessThanOrEqual(40);
    expect(shot.rows * shot.cols * shot.kgPerHole).toBeGreaterThanOrEqual(36);
  });

  it('hole count grows strictly with the grade', () => {
    const counts = [0, 1, 2, 3, 4, 5].map(g => {
      const s = limitSizedShot(PERMIT_LIMITS[g]!, BASE, WIDE);
      return s.rows * s.cols;
    });
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
  });

  it('uses most of a big hole allowance (grade 5 fires well over the grade-0 nine holes)', () => {
    const s = limitSizedShot(PERMIT_LIMITS[5]!, BASE, WIDE);
    expect(s.rows * s.cols).toBeGreaterThanOrEqual(100);
  });

  it('limits too small for the base shot collapse to a single hole', () => {
    const s = limitSizedShot({ maxChargeKg: 0.5, maxHoles: 1 }, BASE, 0.089);
    expect(s.rows).toBe(1);
    expect(s.cols).toBe(1);
    expect(s.kgPerHole).toBeLessThanOrEqual(0.5);
  });

  it('never exceeds the rig diameter cap', () => {
    const s = limitSizedShot(PERMIT_LIMITS[3]!, { ...BASE, diameterM: 0.165 }, 0.127);
    expect(s.diameterM).toBeLessThanOrEqual(0.127);
  });
});

describe('pickDiameter', () => {
  it('returns each option when the cap equals it', () => {
    for (const d of DRILL_HOLE_DIAMETER_OPTIONS_M) expect(pickDiameter(d)).toBe(d);
  });

  it('snaps down between options', () => {
    expect(pickDiameter(0.1)).toBe(0.089);
    expect(pickDiameter(0.15)).toBe(0.127);
    expect(pickDiameter(0.5)).toBe(0.165);
  });

  it('falls back to the smallest option below all of them', () => {
    expect(pickDiameter(0.01)).toBe(DRILL_HOLE_DIAMETER_OPTIONS_M[0]);
  });
});

describe('mayBuyVehicleTier (#2045: one slope limit, no ramp argument)', () => {
  it('allows tier 1 at grade 0', () => {
    expect(mayBuyVehicleTier(1, 0)).toBe(true);
  });

  it('refuses a tier below its unlock grade', () => {
    expect(mayBuyVehicleTier(2, VEHICLE_TIER_UNLOCK_GRADE[2] - 1)).toBe(false);
    expect(mayBuyVehicleTier(3, VEHICLE_TIER_UNLOCK_GRADE[3] - 1)).toBe(false);
  });

  it('allows an unlocked tier whatever ramp exists: upgrading never makes a vehicle worse', () => {
    expect(mayBuyVehicleTier(2, VEHICLE_TIER_UNLOCK_GRADE[2])).toBe(true);
    expect(mayBuyVehicleTier(3, VEHICLE_TIER_UNLOCK_GRADE[3])).toBe(true);
    expect(mayBuyVehicleTier(3, 5)).toBe(true);
  });

  it('takes exactly two parameters', () => {
    expect(mayBuyVehicleTier.length).toBe(2);
  });
});

describe('shouldApplyPermit', () => {
  it('applies when targets are met, nothing is pending and cash covers fee plus reserve', () => {
    expect(shouldApplyPermit(true, false, 10_000, 5_000, 5_000)).toBe(true);
  });
  it('waits while an application is pending', () => {
    expect(shouldApplyPermit(true, true, 1e9, 5_000, 5_000)).toBe(false);
  });
  it('waits while targets are unmet', () => {
    expect(shouldApplyPermit(false, false, 1e9, 5_000, 5_000)).toBe(false);
  });
  it('waits when cash is under fee plus reserve', () => {
    expect(shouldApplyPermit(true, false, 9_999, 5_000, 5_000)).toBe(false);
  });
});

describe('nextBuy', () => {
  const catalog: BuyRule[] = [
    { id: 'a', cost: 5_000 }, { id: 'b', cost: 1_000 }, { id: 'c', cost: 500 },
  ];
  it('returns the first affordable unowned rule in priority order', () => {
    expect(nextBuy(10_000, 0, catalog, new Set())?.id).toBe('a');
  });
  it('skips owned rules', () => {
    expect(nextBuy(10_000, 0, catalog, new Set(['a']))?.id).toBe('b');
  });
  it('skips rules the cash minus reserve cannot pay', () => {
    expect(nextBuy(5_500, 1_000, catalog, new Set())?.id).toBe('b');
  });
  it('returns null when nothing is affordable or everything is owned', () => {
    expect(nextBuy(100, 0, catalog, new Set())).toBeNull();
    expect(nextBuy(1e9, 0, catalog, new Set(['a', 'b', 'c']))).toBeNull();
    expect(nextBuy(1e9, 0, [], new Set())).toBeNull();
  });
});

describe('shouldBench', () => {
  it('benches a wall taller than the stability limit', () => {
    expect(shouldBench(20, 10)).toBe(true);
    expect(shouldBench(10.5, 10)).toBe(true);
  });
});

describe('gradeVerdicts', () => {
  it('classifies in, early, late and missed windows', () => {
    const v = gradeVerdicts({ 3: 9000, 4: 10000, 5: 50000 }, GRADE_TARGET_WINDOWS);
    expect(v.map(x => [x.grade, x.status])).toEqual([[3, 'in'], [4, 'early'], [5, 'late']]);
    expect(v[0]!.tick).toBe(9000);
    expect(v[0]!.window).toEqual(GRADE_TARGET_WINDOWS[3]);
  });

  it('reports a missing grade as missed with a null tick, never omitted', () => {
    const v = gradeVerdicts({ 3: 9000 }, GRADE_TARGET_WINDOWS);
    expect(v).toHaveLength(3);
    expect(v[1]).toMatchObject({ grade: 4, tick: null, status: 'missed' });
    expect(v[2]).toMatchObject({ grade: 5, tick: null, status: 'missed' });
  });

  it('treats window bounds as inclusive', () => {
    const v = gradeVerdicts({ 3: 8000, 4: 25000, 5: 30000 }, GRADE_TARGET_WINDOWS);
    expect(v.map(x => x.status)).toEqual(['in', 'in', 'in']);
  });

  it('returns nothing for no windows', () => {
    expect(gradeVerdicts({ 3: 1 }, {})).toEqual([]);
  });
});

describe('GRADE_TARGET_WINDOWS', () => {
  it('pins the target windows', () => {
    expect(GRADE_TARGET_WINDOWS[3]).toEqual([8000, 14000]);
    expect(GRADE_TARGET_WINDOWS[4]).toEqual([15000, 25000]);
    expect(GRADE_TARGET_WINDOWS[5]).toEqual([30000, 45000]);
  });
});
