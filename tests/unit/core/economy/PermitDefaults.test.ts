// BlastSimulator2026 — Blast Workshop defaults that follow the permit (#2101).
// Contract-only: grade 0 opens the Drill step at 5 m, and the Charge step at the stemming that keeps the
// pattern inside the permit's kilograms once every hole is filled up to it: the 2.5 m default, raised in
// 0.1 m steps until the filled holes fit. More stemming is how a filled pattern carries less explosive.

import { describe, it, expect } from 'vitest';
import { defaultGridDepthM, defaultStemmingM } from '../../../../src/core/economy/PermitDefaults.js';
import { permitLimitsFor } from '../../../../src/core/economy/PermitLimits.js';
import { fillChargeKg, maxChargeKgForHole } from '../../../../src/core/mining/ChargePlan.js';
import { chargeKgPerMetre } from '../../../../src/core/mining/HoleDiameter.js';
import { getAllExplosives, getExplosive } from '../../../../src/core/world/ExplosiveCatalog.js';
import {
  DRILL_GRID_DEFAULT_DEPTH_BY_GRADE_M,
  DRILL_GRID_DEFAULT_DEPTH_M,
  CHARGE_DEFAULT_STEMMING_M,
  DRILL_HOLE_DEFAULT_DIAMETER_M,
  DRILL_HOLE_DIAMETER_OPTIONS_M,
} from '../../../../src/core/config/balance.js';

describe('DRILL_GRID_DEFAULT_DEPTH_BY_GRADE_M', () => {
  it('maps grade 0 to a shallower pattern than the generic default', () => {
    expect(DRILL_GRID_DEFAULT_DEPTH_BY_GRADE_M[0]).toBe(5);
    expect(DRILL_GRID_DEFAULT_DEPTH_BY_GRADE_M[0]!).toBeLessThan(DRILL_GRID_DEFAULT_DEPTH_M);
  });

  it('leaves the generic fallback at 8 m', () => {
    expect(DRILL_GRID_DEFAULT_DEPTH_M).toBe(8);
  });
});

describe('defaultGridDepthM (#2101)', () => {
  it('grade 0 opens at 5 m', () => {
    expect(defaultGridDepthM(0)).toBe(5);
  });

  it('a site without a permit (undefined grade) keeps the generic 8 m', () => {
    expect(defaultGridDepthM(undefined)).toBe(DRILL_GRID_DEFAULT_DEPTH_M);
    expect(defaultGridDepthM(undefined)).toBe(8);
  });

  it.each([1, 2, 3, 5, 6, 12])('grade %i has no map entry and keeps 8 m', (grade) => {
    expect(defaultGridDepthM(grade)).toBe(8);
  });

  it('does not treat grade 0 as "no permit"', () => {
    expect(defaultGridDepthM(0)).not.toBe(defaultGridDepthM(undefined));
  });
});

type TestHole = { depth: number; diameter: number };

/** `count` holes `depth` deep, of bore `diameter`. */
function holes(count: number, depth: number, diameter = DRILL_HOLE_DEFAULT_DIAMETER_M): TestHole[] {
  return Array.from({ length: count }, () => ({ depth, diameter }));
}

/** Kilograms the pattern holds with every hole filled with `explosiveId` up to `stemmingM` (what Charge All loads). */
function filledKg(pattern: readonly TestHole[], stemmingM: number, explosiveId: string): number {
  return pattern.reduce((sum, h) => sum + fillChargeKg(h.depth, stemmingM, h.diameter, explosiveId), 0);
}

/** Kilograms of the pattern's full columns under `stemmingM`, before each hole's fill is floored to 0.1 kg. */
function columnKg(pattern: readonly TestHole[], stemmingM: number, explosiveId: string): number {
  return pattern.reduce((sum, h) => sum + maxChargeKgForHole(h.depth, stemmingM, h.diameter, explosiveId), 0);
}

const step = (stemmingM: number, delta: number): number => Math.round((stemmingM + delta) * 10) / 10;

describe('defaultStemmingM (#2101)', () => {
  it('grade 0, nine 5 m holes of boomite: 2.8 m, the least stemming that keeps the filled holes within 40 kg', () => {
    // Boomite fills 2 kg a metre of an 89 mm hole: at 2.5 m each hole holds 5 kg (45 kg), at 2.7 m 4.6 kg (41.4 kg),
    // at 2.8 m 4.4 kg (39.6 kg).
    const pattern = holes(9, 5);
    expect(defaultStemmingM(0, pattern, 'boomite')).toBe(2.8);
    expect(filledKg(pattern, 2.8, 'boomite')).toBeCloseTo(39.6, 9);
    expect(filledKg(pattern, 2.7, 'boomite')).toBeGreaterThan(permitLimitsFor(0).maxChargeKg);
  });

  it('counts each fill as it is loaded, floored to 0.1 kg: the shortest stemming whose real load fits', () => {
    // Four 6.5 m krackle holes at grade 0: the unrounded columns ask for 3.1 m, but each hole's fill floors to
    // 0.1 kg, so at 3.0 m the four holes load exactly the 40 kg the permit allows.
    const pattern = holes(4, 6.5);
    expect(filledKg(pattern, 3.0, 'krackle')).toBeLessThanOrEqual(permitLimitsFor(0).maxChargeKg);
    expect(defaultStemmingM(0, pattern, 'krackle')).toBe(3.0);
    expect(filledKg(pattern, 2.9, 'krackle')).toBeGreaterThan(permitLimitsFor(0).maxChargeKg);
  });

  it('a pattern the permit lets be filled at the default keeps the default', () => {
    // 45 kg filled at 2.5 m: within grade 1's 120 kg. One 5 m hole holds 5 kg: within grade 0's 40 kg.
    expect(defaultStemmingM(1, holes(9, 5), 'boomite')).toBe(CHARGE_DEFAULT_STEMMING_M);
    expect(defaultStemmingM(0, holes(1, 5), 'boomite')).toBe(CHARGE_DEFAULT_STEMMING_M);
    expect(filledKg(holes(9, 5), CHARGE_DEFAULT_STEMMING_M, 'boomite')).toBeLessThanOrEqual(permitLimitsFor(1).maxChargeKg);
  });

  it('never opens under the default stemming, however roomy the permit', () => {
    for (const depth of [3, 5, 8, 12]) expect(defaultStemmingM(5, holes(4, depth), 'dynatomics')).toBe(CHARGE_DEFAULT_STEMMING_M);
  });

  it('a deeper pattern needs more stemming under the same permit: the permit, not the hole, sets the charge', () => {
    // Nine 8 m holes: 5.8 m (39.6 kg); nine 12 m holes: 9.8 m (39.6 kg) — every hole still holds 4.4 kg.
    expect(defaultStemmingM(0, holes(9, 8), 'boomite')).toBe(5.8);
    expect(defaultStemmingM(0, holes(9, 12), 'boomite')).toBe(9.8);
    for (const depth of [8, 12]) {
      const s = defaultStemmingM(0, holes(9, depth), 'boomite');
      expect(fillChargeKg(depth, s, DRILL_HOLE_DEFAULT_DIAMETER_M, 'boomite')).toBeCloseTo(4.4, 9);
    }
  });

  it('more holes share the same permit, so they open at more stemming', () => {
    const counts = [1, 4, 9, 16, 25];
    const stemmings = counts.map(n => defaultStemmingM(0, holes(n, 5), 'boomite'));
    expect(stemmings[0]).toBe(CHARGE_DEFAULT_STEMMING_M);
    for (let i = 1; i < counts.length; i++) expect(stemmings[i]!, `${counts[i]} holes`).toBeGreaterThanOrEqual(stemmings[i - 1]!);
    expect(stemmings[stemmings.length - 1]!).toBeGreaterThan(stemmings[0]!);
  });

  it('a bigger permit never asks for more stemming for the same pattern', () => {
    for (const depth of [5, 8, 12]) {
      const byGrade = [0, 1, 2, 3].map(g => defaultStemmingM(g, holes(9, depth), 'boomite'));
      for (let g = 1; g < byGrade.length; g++) expect(byGrade[g]!, `grade ${g}, ${depth} m`).toBeLessThanOrEqual(byGrade[g - 1]!);
    }
    // Nine 12 m holes hold 171 kg at the default stemming: grade 2's 800 kg takes them filled.
    expect(defaultStemmingM(2, holes(9, 12), 'boomite')).toBe(CHARGE_DEFAULT_STEMMING_M);
  });

  describe('the explosive and the bore set the kilograms per metre', () => {
    it('a denser explosive packs more into each metre, so it opens at more stemming', () => {
      // Nine 5 m holes at grade 0: boomite (0.8 g/cm³) 2.8 m, krackle (1.15) 3.5 m, dynatomics (1.6) 3.9 m.
      const pattern = holes(9, 5);
      expect(defaultStemmingM(0, pattern, 'krackle')).toBe(3.5);
      expect(defaultStemmingM(0, pattern, 'dynatomics')).toBe(3.9);
      const byDensity = [...getAllExplosives()].sort((a, b) => a.density - b.density);
      for (let i = 1; i < byDensity.length; i++) {
        expect(defaultStemmingM(0, pattern, byDensity[i]!.id), byDensity[i]!.id)
          .toBeGreaterThanOrEqual(defaultStemmingM(0, pattern, byDensity[i - 1]!.id));
      }
    });

    it('a light explosive fills the same pattern within the permit at the default stemming', () => {
      // Pop rock (0.55 g/cm³) holds 1.375 kg a metre: nine 5 m holes take 30.6 kg at 2.5 m.
      expect(getExplosive('pop_rock')!.density).toBeLessThan(getExplosive('boomite')!.density);
      expect(defaultStemmingM(0, holes(9, 5), 'pop_rock')).toBe(CHARGE_DEFAULT_STEMMING_M);
      expect(filledKg(holes(9, 5), CHARGE_DEFAULT_STEMMING_M, 'pop_rock')).toBeLessThanOrEqual(permitLimitsFor(0).maxChargeKg);
    });

    it('a wider bore holds more per metre, so it opens at more stemming', () => {
      const wide = DRILL_HOLE_DIAMETER_OPTIONS_M.find(d => d > DRILL_HOLE_DEFAULT_DIAMETER_M)!;
      expect(chargeKgPerMetre(wide, 'boomite')).toBeGreaterThan(chargeKgPerMetre(DRILL_HOLE_DEFAULT_DIAMETER_M, 'boomite'));
      const s = defaultStemmingM(0, holes(9, 5, wide), 'boomite');
      expect(s).toBeGreaterThan(defaultStemmingM(0, holes(9, 5), 'boomite'));
      expect(filledKg(holes(9, 5, wide), s, 'boomite')).toBeLessThanOrEqual(permitLimitsFor(0).maxChargeKg);
    });

    it('an unknown explosive reads the reference density, as the per-metre capacity does', () => {
      expect(chargeKgPerMetre(DRILL_HOLE_DEFAULT_DIAMETER_M, 'no_such_explosive')).toBe(chargeKgPerMetre(DRILL_HOLE_DEFAULT_DIAMETER_M));
      expect(defaultStemmingM(0, holes(9, 5), 'no_such_explosive')).toBe(defaultStemmingM(0, holes(9, 5), 'boomite'));
    });
  });

  it('counts every hole by its own depth, not the first or the shallowest alone', () => {
    // One 6 m hole among 8 m ones holds less, so the pattern needs less stemming than nine 8 m holes (5.8 m).
    const pattern = holes(9, 8);
    pattern[4] = { depth: 6, diameter: DRILL_HOLE_DEFAULT_DIAMETER_M };
    expect(defaultStemmingM(0, pattern, 'boomite')).toBe(5.6);
    expect(filledKg(pattern, 5.6, 'boomite')).toBeLessThanOrEqual(permitLimitsFor(0).maxChargeKg);
    expect(filledKg(pattern, 5.5, 'boomite')).toBeGreaterThan(permitLimitsFor(0).maxChargeKg);
  });

  describe('falls back to the default stemming', () => {
    it('a site without a permit, whatever the pattern', () => {
      expect(defaultStemmingM(undefined, holes(9, 5), 'boomite')).toBe(CHARGE_DEFAULT_STEMMING_M);
      expect(defaultStemmingM(undefined, holes(1, 30), 'dynatomics')).toBe(2.5);
    });

    it.each([0, 1, 2])('no holes planned at grade %i', (grade) => {
      expect(defaultStemmingM(grade, [], 'boomite')).toBe(CHARGE_DEFAULT_STEMMING_M);
    });

    it('a shallow hole the needed stemming would leave empty: no stemming meets the permit, the over-permit warning says so', () => {
      // Eight 8 m holes and one 4 m hole: keeping 40 kg would take 5.4 m of stemming, deeper than the 4 m hole.
      const pattern = holes(9, 8);
      pattern[4] = { depth: 4, diameter: DRILL_HOLE_DEFAULT_DIAMETER_M };
      expect(defaultStemmingM(0, pattern, 'boomite')).toBe(CHARGE_DEFAULT_STEMMING_M);
      expect(filledKg(pattern, CHARGE_DEFAULT_STEMMING_M, 'boomite')).toBeGreaterThan(permitLimitsFor(0).maxChargeKg);
    });

    it('a permit too small for a 0.1 m column in every hole', () => {
      // 300 holes share 40 kg: 0.13 kg a hole, less than one 0.1 m step of boomite (0.2 kg).
      expect(defaultStemmingM(0, holes(300, 5), 'boomite')).toBe(CHARGE_DEFAULT_STEMMING_M);
    });

    it('holes no deeper than the default stemming have nothing to fill at any stemming', () => {
      expect(defaultStemmingM(0, holes(9, CHARGE_DEFAULT_STEMMING_M), 'boomite')).toBe(CHARGE_DEFAULT_STEMMING_M);
      expect(defaultStemmingM(0, holes(9, 2), 'boomite')).toBe(CHARGE_DEFAULT_STEMMING_M);
    });
  });

  describe('invariants over a sweep of patterns', () => {
    const cases: Array<{ grade: number; pattern: TestHole[]; explosiveId: string; label: string }> = [];
    for (const grade of [0, 1, 2, 3]) {
      for (const count of [1, 2, 4, 6, 9, 12, 16]) {
        for (const depth of [3.7, 5, 6.5, 8, 11.2]) {
          for (const explosiveId of ['pop_rock', 'boomite', 'krackle', 'dynatomics']) {
            cases.push({ grade, pattern: holes(count, depth), explosiveId, label: `grade ${grade}, ${count} x ${depth} m, ${explosiveId}` });
          }
        }
      }
    }

    it('is the default or more, in whole 0.1 m steps', () => {
      for (const { grade, pattern, explosiveId, label } of cases) {
        const s = defaultStemmingM(grade, pattern, explosiveId);
        expect(s, label).toBeGreaterThanOrEqual(CHARGE_DEFAULT_STEMMING_M);
        expect(Math.abs(s * 10 - Math.round(s * 10)), label).toBeLessThan(1e-9);
      }
    });

    it('whenever the stemming is raised, every hole still holds explosive and the filled pattern stays inside the permit', () => {
      for (const { grade, pattern, explosiveId, label } of cases) {
        const s = defaultStemmingM(grade, pattern, explosiveId);
        if (s === CHARGE_DEFAULT_STEMMING_M) continue;
        for (const h of pattern) expect(fillChargeKg(h.depth, s, h.diameter, explosiveId), label).toBeGreaterThan(0);
        expect(filledKg(pattern, s, explosiveId), label).toBeLessThanOrEqual(permitLimitsFor(grade).maxChargeKg + 1e-9);
      }
    });

    it('a raised stemming is the least that does it: one step less, the full columns overrun the permit', () => {
      for (const { grade, pattern, explosiveId, label } of cases) {
        const s = defaultStemmingM(grade, pattern, explosiveId);
        if (s === CHARGE_DEFAULT_STEMMING_M) continue;
        expect(columnKg(pattern, step(s, -0.1), explosiveId), label).toBeGreaterThan(permitLimitsFor(grade).maxChargeKg);
      }
    });

    it('the default is kept only when the pattern fits filled at it, or no stemming short of the shallowest hole fits', () => {
      for (const { grade, pattern, explosiveId, label } of cases) {
        if (defaultStemmingM(grade, pattern, explosiveId) !== CHARGE_DEFAULT_STEMMING_M) continue;
        const limit = permitLimitsFor(grade).maxChargeKg;
        if (filledKg(pattern, CHARGE_DEFAULT_STEMMING_M, explosiveId) <= limit) continue;
        const shallowest = Math.min(...pattern.map(h => h.depth));
        for (let s = CHARGE_DEFAULT_STEMMING_M; s < shallowest - 1e-9; s = step(s, 0.1)) {
          expect(columnKg(pattern, s, explosiveId), `${label} at ${s} m`).toBeGreaterThan(limit);
        }
      }
    });
  });
});
