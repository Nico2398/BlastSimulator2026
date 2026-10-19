// BlastSimulator2026 — per-ore market saturation (#1930)
import { describe, it, expect } from 'vitest';
import {
  marketDepthKg,
  saturationAt,
  saturationFactor,
  recordOreSale,
  saturationReader,
  sanitizeOreSaturation,
  oreSaturationTrend,
  type OreSaturationState,
} from '../../../src/core/economy/OreSaturation.js';
import {
  ORE_MARKET_DEPTH_KG,
  ORE_SATURATION_HALF_LIFE_TICKS,
  ORE_PRICES,
} from '../../../src/core/config/balance.js';

describe('marketDepthKg', () => {
  it('is the base depth at grade 0 (local buyers only)', () => {
    for (const [ore, depth] of Object.entries(ORE_MARKET_DEPTH_KG)) expect(marketDepthKg(ore, 0)).toBe(depth);
    expect(marketDepthKg('dirtite', 0)).toBe(20_000);
    expect(marketDepthKg('treranium', 0)).toBe(2_000);
  });

  it.each([[1, 2], [3, 5], [5, 12]])('grade %i multiplies depth by %i', (grade, mult) => {
    expect(marketDepthKg('dirtite', grade)).toBe(20_000 * mult);
    expect(marketDepthKg('absurdium', grade)).toBe(3_000 * mult);
  });

  it('a grade between unlocks uses the highest unlocked tier', () => {
    expect(marketDepthKg('rustite', 2)).toBe(marketDepthKg('rustite', 1));
    expect(marketDepthKg('rustite', 4)).toBe(marketDepthKg('rustite', 3));
    expect(marketDepthKg('rustite', 9)).toBe(marketDepthKg('rustite', 5));
  });

  it('depth never shrinks as the grade rises', () => {
    let prev = 0;
    for (let g = 0; g <= 8; g++) {
      const d = marketDepthKg('gloomium', g);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});

describe('saturationAt', () => {
  it('reads 0 for an absent entry', () => {
    expect(saturationAt(undefined, 100)).toBe(0);
  });

  it('is the stored level at the stored tick', () => {
    expect(saturationAt({ level: 0.6, tick: 40 }, 40)).toBeCloseTo(0.6, 9);
  });

  it('halves after one half-life', () => {
    expect(ORE_SATURATION_HALF_LIFE_TICKS).toBe(500);
    expect(saturationAt({ level: 0.8, tick: 100 }, 600)).toBeCloseTo(0.4, 9);
  });

  it('quarters after two half-lives', () => {
    expect(saturationAt({ level: 1, tick: 0 }, 1000)).toBeCloseTo(0.25, 9);
  });

  it('decays smoothly between half-lives', () => {
    expect(saturationAt({ level: 1, tick: 0 }, 250)).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('clamps negative elapsed time to no decay', () => {
    expect(saturationAt({ level: 0.7, tick: 300 }, 100)).toBeCloseTo(0.7, 9);
  });

  it('does not mutate the entry', () => {
    const entry = { level: 0.9, tick: 0 };
    saturationAt(entry, 5000);
    expect(entry).toEqual({ level: 0.9, tick: 0 });
  });
});

describe('saturationFactor', () => {
  it('is 1 with no saturation, 0.75 at half and 0.5 when full', () => {
    expect(saturationFactor(0)).toBe(1);
    expect(saturationFactor(0.5)).toBeCloseTo(0.75, 9);
    expect(saturationFactor(1)).toBeCloseTo(0.5, 9);
  });

  it('clamps out-of-range saturation', () => {
    expect(saturationFactor(-3)).toBe(1);
    expect(saturationFactor(7)).toBeCloseTo(0.5, 9);
  });
});

describe('recordOreSale', () => {
  it('adds kg over market depth', () => {
    const state: OreSaturationState = {};
    const r = recordOreSale(state, 'dirtite', 5_000, 10, 0);
    expect(r.before).toBe(0);
    expect(r.after).toBeCloseTo(0.25, 9);
    expect(state['dirtite']).toEqual({ level: expect.closeTo(0.25, 9), tick: 10 });
    expect(r.crossed).toBe(false);
  });

  it('10 t of dirtite at grade 0 reaches 50% and crosses the toast level', () => {
    const state: OreSaturationState = {};
    const r = recordOreSale(state, 'dirtite', 10_000, 0, 0);
    expect(r.after).toBeCloseTo(0.5, 9);
    expect(r.crossed).toBe(true);
  });

  it('the same delivery at grade 1 saturates half as much and does not cross', () => {
    const state: OreSaturationState = {};
    const r = recordOreSale(state, 'dirtite', 10_000, 0, 1);
    expect(r.after).toBeCloseTo(0.25, 9);
    expect(r.crossed).toBe(false);
  });

  it('500 ticks after a 50% sale the saturation has halved', () => {
    const state: OreSaturationState = {};
    recordOreSale(state, 'dirtite', 10_000, 0, 0);
    expect(saturationAt(state['dirtite'], 500)).toBeCloseTo(0.25, 9);
  });

  it('stacks on the decayed level, not the stale one', () => {
    const state: OreSaturationState = {};
    recordOreSale(state, 'dirtite', 10_000, 0, 0);
    const r = recordOreSale(state, 'dirtite', 2_000, 500, 0);
    expect(r.before).toBeCloseTo(0.25, 9);
    expect(r.after).toBeCloseTo(0.35, 9);
    expect(state['dirtite']!.tick).toBe(500);
  });

  it('clamps at 1', () => {
    const state: OreSaturationState = {};
    const r = recordOreSale(state, 'treranium', 1_000_000, 0, 0);
    expect(r.after).toBe(1);
    expect(state['treranium']!.level).toBe(1);
  });

  it('keeps ores independent', () => {
    const state: OreSaturationState = {};
    recordOreSale(state, 'dirtite', 10_000, 0, 0);
    recordOreSale(state, 'rustite', 3_000, 0, 0);
    expect(Object.keys(state).sort()).toEqual(['dirtite', 'rustite']);
    expect(state['rustite']!.level).toBeCloseTo(0.2, 9);
  });

  it.each([0, -50, NaN])('ignores kg = %s', (kg) => {
    const state: OreSaturationState = {};
    const r = recordOreSale(state, 'dirtite', kg, 0, 0);
    expect(state).toEqual({});
    expect(r.after).toBe(r.before);
    expect(r.crossed).toBe(false);
  });

  it('ignores an unknown ore', () => {
    const state: OreSaturationState = {};
    const r = recordOreSale(state, 'unobtainium', 10_000, 0, 0);
    expect(state).toEqual({});
    expect(r.crossed).toBe(false);
  });

  it('crosses only on the upward crossing, not while already above', () => {
    const state: OreSaturationState = {};
    expect(recordOreSale(state, 'dirtite', 8_000, 0, 0).crossed).toBe(false); // 0.4
    expect(recordOreSale(state, 'dirtite', 4_000, 0, 0).crossed).toBe(true); // 0.6
    expect(recordOreSale(state, 'dirtite', 1_000, 0, 0).crossed).toBe(false); // 0.65
  });

  it('re-arms once the saturation decays below the toast level', () => {
    const state: OreSaturationState = {};
    expect(recordOreSale(state, 'dirtite', 12_000, 0, 0).crossed).toBe(true); // 0.6
    // 500 ticks later: 0.3; +0.25 -> 0.55 crosses again
    expect(recordOreSale(state, 'dirtite', 5_000, 500, 0).crossed).toBe(true);
  });
});

describe('saturationReader', () => {
  it('reads decayed saturation as of the given tick', () => {
    const state: OreSaturationState = { dirtite: { level: 0.8, tick: 0 } };
    const read = saturationReader(state, 500);
    expect(read('dirtite')).toBeCloseTo(0.4, 9);
    expect(read('rustite')).toBe(0);
  });

  it('reads 0 for every ore when state is absent', () => {
    const read = saturationReader(undefined, 123);
    for (const ore of Object.keys(ORE_PRICES)) expect(read(ore)).toBe(0);
  });
});

describe('sanitizeOreSaturation', () => {
  it('keeps a valid state', () => {
    expect(sanitizeOreSaturation({ dirtite: { level: 0.4, tick: 12 } })).toEqual({ dirtite: { level: 0.4, tick: 12 } });
  });

  it.each([undefined, null, 5, 'x', [], {}])('returns undefined for %j', (raw) => {
    expect(sanitizeOreSaturation(raw)).toBeUndefined();
  });

  it('drops malformed entries and keeps the good ones', () => {
    const out = sanitizeOreSaturation({
      dirtite: { level: 0.4, tick: 12 },
      rustite: { level: 'high', tick: 3 },
      blingite: null,
      gloomium: { level: 0.2 },
      sparkium: { level: NaN, tick: 1 },
      craktonite: 'x',
    });
    expect(out).toEqual({ dirtite: { level: 0.4, tick: 12 } });
  });

  it('returns undefined when every entry is malformed', () => {
    expect(sanitizeOreSaturation({ dirtite: { level: 'x', tick: 1 } })).toBeUndefined();
  });

  it('clamps the level to 0..1 and the tick to at least 0', () => {
    const out = sanitizeOreSaturation({ dirtite: { level: 4, tick: 5 }, rustite: { level: -1, tick: -9 } });
    expect(out!['dirtite']!.level).toBe(1);
    expect(out!['rustite']!.level).toBe(0);
    expect(out!['rustite']!.tick).toBeGreaterThanOrEqual(0);
  });
});

describe('oreSaturationTrend', () => {
  it('reports a rounded percent drop and the discounted price', () => {
    const r = oreSaturationTrend('dirtite', 0.5, 21);
    expect(r.pct).toBe(-25);
    expect(r.price).toBeCloseTo(15.75, 9);
  });

  it('is no change at zero saturation', () => {
    const r = oreSaturationTrend('dirtite', 0, 21);
    expect(r.pct).toBeCloseTo(0, 9);
    expect(r.price).toBeCloseTo(21, 9);
  });

  it('is -50% when full', () => {
    const r = oreSaturationTrend('rustite', 1, 40);
    expect(r.pct).toBe(-50);
    expect(r.price).toBeCloseTo(20, 9);
  });

  it('rounds the percent to a whole number', () => {
    expect(oreSaturationTrend('dirtite', 0.333, 100).pct).toBe(-17);
  });
});
