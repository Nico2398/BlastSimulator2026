import { describe, it, expect } from 'vitest';
import {
  decideBuriedPattern,
  decideLadderShotSide,
  siteHoldsOre,
  LADDER_BURIED_DROP_TICKS,
  LADDER_G2_MAX_SIDE,
  LADDER_SEALED_SHRINK_COUNT,
  LADDER_SITE_ORE_FLOOR,
  LADDER_SITE_ORE_SHARE,
  LADDER_GATE_MIN_GRADE,
} from '../../scripts/shared/probe-ladder-policy';

describe('decideBuriedPattern', () => {
  it('waits with null when no holes are buried', () => {
    expect(decideBuriedPattern({ buriedHoleCount: 0, buriedSinceTick: null, tick: 100 }))
      .toEqual({ action: 'wait', buriedSinceTick: null });
  });

  it('records the tick on the first buried call', () => {
    expect(decideBuriedPattern({ buriedHoleCount: 3, buriedSinceTick: null, tick: 250 }))
      .toEqual({ action: 'wait', buriedSinceTick: 250 });
  });

  it('keeps waiting one tick before the drop threshold', () => {
    const since = 1000;
    const d = decideBuriedPattern({ buriedHoleCount: 2, buriedSinceTick: since, tick: since + LADDER_BURIED_DROP_TICKS - 1 });
    expect(d).toEqual({ action: 'wait', buriedSinceTick: since });
  });

  it('drops exactly at the threshold and resets', () => {
    const since = 1000;
    const d = decideBuriedPattern({ buriedHoleCount: 2, buriedSinceTick: since, tick: since + LADDER_BURIED_DROP_TICKS });
    expect(d).toEqual({ action: 'drop', buriedSinceTick: null });
  });

  it('drops when buried well past the threshold', () => {
    const d = decideBuriedPattern({ buriedHoleCount: 1, buriedSinceTick: 0, tick: LADDER_BURIED_DROP_TICKS * 3 });
    expect(d.action).toBe('drop');
    expect(d.buriedSinceTick).toBeNull();
  });

  it('resets when the count falls to 0 mid-wait', () => {
    expect(decideBuriedPattern({ buriedHoleCount: 0, buriedSinceTick: 1000, tick: 1200 }))
      .toEqual({ action: 'wait', buriedSinceTick: null });
  });

  it('does not drop when the count is 0 even past the threshold', () => {
    expect(decideBuriedPattern({ buriedHoleCount: 0, buriedSinceTick: 0, tick: LADDER_BURIED_DROP_TICKS * 2 }).action)
      .toBe('wait');
  });
});

describe('decideLadderShotSide', () => {
  const clean = { lastShotFailed: false, sealedRubbleCount: 0 };

  it('returns limitSide below the gate grade', () => {
    for (let limitSide = 1; limitSide <= 8; limitSide++) {
      expect(decideLadderShotSide({ ...clean, limitSide, grade: LADDER_GATE_MIN_GRADE - 1 })).toBe(limitSide);
    }
  });

  it('caps at LADDER_G2_MAX_SIDE for clean shots at the gate grade', () => {
    expect(decideLadderShotSide({ ...clean, limitSide: 8, grade: LADDER_GATE_MIN_GRADE })).toBe(LADDER_G2_MAX_SIDE);
    expect(decideLadderShotSide({ ...clean, limitSide: 2, grade: LADDER_GATE_MIN_GRADE })).toBe(2);
    expect(decideLadderShotSide({ ...clean, limitSide: 8, grade: LADDER_GATE_MIN_GRADE + 2 }))
      .toBe(Math.min(8, LADDER_G2_MAX_SIDE));
  });

  // #2080: a clean grade-2+ shot of side 3 (9 holes) starves ore yield; the Shareholder Summit
  // competent run then ends game_over:worker_revolt. Measured: any cap >= 4 passes. 4 is the floor
  // of starvation, so the clean side must reach it whenever the permit limit allows.
  const STARVATION_FLOOR_SIDE = 4;

  it('keeps clean grade-2+ shots at or above the starvation floor given a large limit', () => {
    for (const grade of [LADDER_GATE_MIN_GRADE, LADDER_GATE_MIN_GRADE + 1, 3, 4, 5]) {
      expect(decideLadderShotSide({ ...clean, limitSide: 8, grade })).toBeGreaterThanOrEqual(STARVATION_FLOOR_SIDE);
      expect(decideLadderShotSide({ ...clean, limitSide: 20, grade })).toBeGreaterThanOrEqual(STARVATION_FLOOR_SIDE);
    }
    expect(LADDER_G2_MAX_SIDE).toBeGreaterThanOrEqual(STARVATION_FLOOR_SIDE);
  });

  it('still shrinks strictly below the floor-sized clean shot on failure and sealed rubble', () => {
    const cleanSide = decideLadderShotSide({ ...clean, limitSide: 8, grade: 3 });
    expect(cleanSide).toBeGreaterThanOrEqual(STARVATION_FLOOR_SIDE);
    expect(decideLadderShotSide({ ...clean, lastShotFailed: true, limitSide: 8, grade: 3 })).toBeLessThan(cleanSide);
    expect(decideLadderShotSide({ ...clean, sealedRubbleCount: LADDER_SEALED_SHRINK_COUNT, limitSide: 8, grade: 3 }))
      .toBeLessThan(cleanSide);
  });

  it('shrinks strictly after a failed shot', () => {
    const cleanSide = decideLadderShotSide({ ...clean, limitSide: 8, grade: 2 });
    const failed = decideLadderShotSide({ ...clean, lastShotFailed: true, limitSide: 8, grade: 2 });
    expect(failed).toBeLessThan(cleanSide);
    expect(failed).toBeGreaterThanOrEqual(1);
  });

  it('shrinks strictly at the sealed rubble threshold', () => {
    const cleanSide = decideLadderShotSide({ ...clean, limitSide: 8, grade: 2 });
    const sealed = decideLadderShotSide({ ...clean, sealedRubbleCount: LADDER_SEALED_SHRINK_COUNT, limitSide: 8, grade: 2 });
    expect(sealed).toBeLessThan(cleanSide);
    expect(sealed).toBeGreaterThanOrEqual(1);
  });

  it('does not shrink just under the sealed threshold', () => {
    const cleanSide = decideLadderShotSide({ ...clean, limitSide: 8, grade: 2 });
    expect(decideLadderShotSide({ ...clean, sealedRubbleCount: LADDER_SEALED_SHRINK_COUNT - 1, limitSide: 8, grade: 2 }))
      .toBe(cleanSide);
  });

  it('stays at 1 when the clean value is already 1', () => {
    expect(decideLadderShotSide({ limitSide: 1, grade: 2, lastShotFailed: true, sealedRubbleCount: 0 })).toBe(1);
    expect(decideLadderShotSide({ limitSide: 1, grade: 2, lastShotFailed: false, sealedRubbleCount: LADDER_SEALED_SHRINK_COUNT })).toBe(1);
    expect(decideLadderShotSide({ limitSide: 1, grade: 2, lastShotFailed: false, sealedRubbleCount: 0 })).toBe(1);
  });

  it('shrinks a limit of 2 to 1 on failure', () => {
    expect(decideLadderShotSide({ limitSide: 2, grade: 2, lastShotFailed: true, sealedRubbleCount: 0 })).toBe(1);
  });

  it('stays within [1, limitSide] across the input space', () => {
    for (let limitSide = 1; limitSide <= 10; limitSide++) {
      for (const grade of [0, 1, 2, 3, 5]) {
        for (const lastShotFailed of [false, true]) {
          for (const sealedRubbleCount of [0, 1, LADDER_SEALED_SHRINK_COUNT - 1, LADDER_SEALED_SHRINK_COUNT, 1000, 100000]) {
            const side = decideLadderShotSide({ limitSide, grade, lastShotFailed, sealedRubbleCount });
            expect(side).toBeGreaterThanOrEqual(1);
            expect(side).toBeLessThanOrEqual(limitSide);
          }
        }
      }
    }
  });

  it('is non-increasing in sealedRubbleCount', () => {
    for (let limitSide = 1; limitSide <= 10; limitSide++) {
      for (const grade of [0, 2, 4]) {
        for (const lastShotFailed of [false, true]) {
          let prev = Infinity;
          for (let n = 0; n <= 600; n += 10) {
            const side = decideLadderShotSide({ limitSide, grade, lastShotFailed, sealedRubbleCount: n });
            expect(side).toBeLessThanOrEqual(prev);
            prev = side;
          }
        }
      }
    }
  });
});

describe('siteHoldsOre', () => {
  it('is false for an ore-free site when another site has ore', () => {
    expect(siteHoldsOre({ oreKgUnderSite: 0, bestSiteOre: 1000 })).toBe(false);
  });

  it('is true when no site has ore', () => {
    expect(siteHoldsOre({ oreKgUnderSite: 0, bestSiteOre: 0 })).toBe(true);
  });

  it('is true at exactly the share of the best site', () => {
    const best = 4000;
    expect(best * LADDER_SITE_ORE_SHARE).toBeGreaterThanOrEqual(LADDER_SITE_ORE_FLOOR);
    expect(siteHoldsOre({ oreKgUnderSite: LADDER_SITE_ORE_SHARE * best, bestSiteOre: best })).toBe(true);
  });

  it('is false just under the share of the best site', () => {
    const best = 4000;
    expect(siteHoldsOre({ oreKgUnderSite: LADDER_SITE_ORE_SHARE * best - 1, bestSiteOre: best })).toBe(false);
  });

  it('is true for the best site itself', () => {
    expect(siteHoldsOre({ oreKgUnderSite: 5000, bestSiteOre: 5000 })).toBe(true);
  });
});
