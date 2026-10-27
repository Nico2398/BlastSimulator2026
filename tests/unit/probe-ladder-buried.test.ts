import { describe, it, expect } from 'vitest';
import {
  decideBuriedPattern,
  decideLadderShotSide,
  siteHoldsOre,
  LADDER_BURIED_DROP_TICKS,
  LADDER_SITE_ORE_FLOOR,
  LADDER_SITE_ORE_SHARE,
  LADDER_GATE_MIN_GRADE,
} from '../../scripts/shared/probe-ladder-policy';

describe('decideBuriedPattern', () => {
  it('waits with null when no holes are buried', () => {
    expect(decideBuriedPattern({ buriedHoleCount: 0, previousBuriedHoleCount: null, buriedSinceTick: null, tick: 100 }))
      .toEqual({ action: 'wait', buriedSinceTick: null });
  });

  it('records the tick on the first buried call', () => {
    expect(decideBuriedPattern({ buriedHoleCount: 3, previousBuriedHoleCount: null, buriedSinceTick: null, tick: 250 }))
      .toEqual({ action: 'wait', buriedSinceTick: 250 });
  });

  it('keeps waiting one tick before the drop threshold', () => {
    const since = 1000;
    const d = decideBuriedPattern({ buriedHoleCount: 2, previousBuriedHoleCount: null, buriedSinceTick: since, tick: since + LADDER_BURIED_DROP_TICKS - 1 });
    expect(d).toEqual({ action: 'wait', buriedSinceTick: since });
  });

  it('drops exactly at the threshold and resets', () => {
    const since = 1000;
    const d = decideBuriedPattern({ buriedHoleCount: 2, previousBuriedHoleCount: null, buriedSinceTick: since, tick: since + LADDER_BURIED_DROP_TICKS });
    expect(d).toEqual({ action: 'drop', buriedSinceTick: null });
  });

  it('drops when buried well past the threshold', () => {
    const d = decideBuriedPattern({ buriedHoleCount: 1, previousBuriedHoleCount: null, buriedSinceTick: 0, tick: LADDER_BURIED_DROP_TICKS * 3 });
    expect(d.action).toBe('drop');
    expect(d.buriedSinceTick).toBeNull();
  });

  it('resets when the count falls to 0 mid-wait', () => {
    expect(decideBuriedPattern({ buriedHoleCount: 0, previousBuriedHoleCount: null, buriedSinceTick: 1000, tick: 1200 }))
      .toEqual({ action: 'wait', buriedSinceTick: null });
  });

  it('restarts the clock when a buried hole came free since the last call: the crew is clearing them', () => {
    const d = decideBuriedPattern({ buriedHoleCount: 2, previousBuriedHoleCount: 3, buriedSinceTick: 0, tick: LADDER_BURIED_DROP_TICKS * 3 });
    expect(d).toEqual({ action: 'wait', buriedSinceTick: LADDER_BURIED_DROP_TICKS * 3 });
  });

  it('drops when no hole came free for the whole threshold', () => {
    const d = decideBuriedPattern({ buriedHoleCount: 3, previousBuriedHoleCount: 3, buriedSinceTick: 0, tick: LADDER_BURIED_DROP_TICKS });
    expect(d.action).toBe('drop');
  });

  it('a count that grew (a later shot buried more) is no progress', () => {
    const d = decideBuriedPattern({ buriedHoleCount: 4, previousBuriedHoleCount: 3, buriedSinceTick: 0, tick: LADDER_BURIED_DROP_TICKS });
    expect(d.action).toBe('drop');
  });

  it('restarts the clock when fewer fragments bury the holes than at the last call: the crew is hauling them off (#2091)', () => {
    const d = decideBuriedPattern({
      buriedHoleCount: 1, previousBuriedHoleCount: 1, buryingFragmentCount: 80, previousBuryingFragmentCount: 81,
      buriedSinceTick: 0, tick: LADDER_BURIED_DROP_TICKS * 3,
    });
    expect(d).toEqual({ action: 'wait', buriedSinceTick: LADDER_BURIED_DROP_TICKS * 3 });
  });

  it('drops when the burying fragments grew or held for the whole threshold (#2091)', () => {
    for (const count of [81, 90]) {
      const d = decideBuriedPattern({
        buriedHoleCount: 1, previousBuriedHoleCount: 1, buryingFragmentCount: count, previousBuryingFragmentCount: 81,
        buriedSinceTick: 0, tick: LADDER_BURIED_DROP_TICKS,
      });
      expect(d.action).toBe('drop');
    }
  });

  it('a first fragment count is no progress yet', () => {
    const d = decideBuriedPattern({
      buriedHoleCount: 1, previousBuriedHoleCount: 1, buryingFragmentCount: 80, previousBuryingFragmentCount: null,
      buriedSinceTick: 0, tick: LADDER_BURIED_DROP_TICKS,
    });
    expect(d.action).toBe('drop');
  });

  it('does not drop when the count is 0 even past the threshold', () => {
    expect(decideBuriedPattern({ buriedHoleCount: 0, previousBuriedHoleCount: null, buriedSinceTick: 0, tick: LADDER_BURIED_DROP_TICKS * 2 }).action)
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

  // #2080: a clean grade-2+ shot of side 3 (9 holes) starves ore yield; the Shareholder Summit
  // competent run then ends game_over:worker_revolt. Clean state must return limitSide unchanged.
  it('clean state returns limitSide at every grade', () => {
    for (const grade of [0, 1, LADDER_GATE_MIN_GRADE, 3, 4, 5]) {
      for (let limitSide = 1; limitSide <= 20; limitSide++) {
        expect(decideLadderShotSide({ ...clean, limitSide, grade })).toBe(limitSide);
      }
    }
  });

  it('shrinks strictly below the clean side on failure', () => {
    const cleanSide = decideLadderShotSide({ ...clean, limitSide: 8, grade: 3 });
    expect(decideLadderShotSide({ ...clean, lastShotFailed: true, limitSide: 8, grade: 3 })).toBeLessThan(cleanSide);
  });

  it('shrinks strictly after a failed shot', () => {
    const cleanSide = decideLadderShotSide({ ...clean, limitSide: 8, grade: 2 });
    const failed = decideLadderShotSide({ ...clean, lastShotFailed: true, limitSide: 8, grade: 2 });
    expect(failed).toBeLessThan(cleanSide);
    expect(failed).toBeGreaterThanOrEqual(1);
  });

  // Regression pin (#2080): a sealed-rubble shrink alone reproduced game_over:worker_revolt in the
  // Shareholder Summit competent run. Sealed rubble must never move the side.
  it('does not shrink the side for sealed rubble at any count', () => {
    for (const grade of [0, 2, 3]) {
      for (const sealedRubbleCount of [0, 99, 100, 101, 1000, 100000]) {
        expect(decideLadderShotSide({ ...clean, sealedRubbleCount, limitSide: 8, grade })).toBe(8);
      }
    }
  });

  it('stays at 1 when the clean value is already 1', () => {
    expect(decideLadderShotSide({ limitSide: 1, grade: 2, lastShotFailed: true, sealedRubbleCount: 0 })).toBe(1);
    expect(decideLadderShotSide({ limitSide: 1, grade: 2, lastShotFailed: false, sealedRubbleCount: 100 })).toBe(1);
    expect(decideLadderShotSide({ limitSide: 1, grade: 2, lastShotFailed: false, sealedRubbleCount: 0 })).toBe(1);
  });

  it('shrinks a limit of 2 to 1 on failure', () => {
    expect(decideLadderShotSide({ limitSide: 2, grade: 2, lastShotFailed: true, sealedRubbleCount: 0 })).toBe(1);
  });

  it('stays within [1, limitSide] across the input space', () => {
    for (let limitSide = 1; limitSide <= 10; limitSide++) {
      for (const grade of [0, 1, 2, 3, 5]) {
        for (const lastShotFailed of [false, true]) {
          for (const sealedRubbleCount of [0, 1, 99, 100, 1000, 100000]) {
            const side = decideLadderShotSide({ limitSide, grade, lastShotFailed, sealedRubbleCount });
            expect(side).toBeGreaterThanOrEqual(1);
            expect(side).toBeLessThanOrEqual(limitSide);
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
