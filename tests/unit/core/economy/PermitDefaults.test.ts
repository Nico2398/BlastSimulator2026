// BlastSimulator2026 — Blast Workshop defaults that follow the permit (#2101).
// Contract-only: grade 0 opens the Drill step at 5 m and the Charge step at the biggest whole-kg
// charge that fits the shallowest hole and keeps the whole pattern inside the permit.

import { describe, it, expect } from 'vitest';
import { defaultGridDepthM, defaultChargeKg } from '../../../../src/core/economy/PermitDefaults.js';
import { permitLimitsFor } from '../../../../src/core/economy/PermitLimits.js';
import { maxChargeKgForHole } from '../../../../src/core/mining/ChargePlan.js';
import {
  DRILL_GRID_DEFAULT_DEPTH_BY_GRADE_M,
  DRILL_GRID_DEFAULT_DEPTH_M,
  CHARGE_DEFAULT_AMOUNT_KG,
  CHARGE_DEFAULT_STEMMING_M,
  DRILL_HOLE_DEFAULT_DIAMETER_M,
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

describe('defaultChargeKg (#2101)', () => {
  it('grade 0, nine 5 m holes, 2.5 m stemming: 4 kg (40 kg permit over nine holes)', () => {
    expect(defaultChargeKg(0, 9, 5, CHARGE_DEFAULT_STEMMING_M)).toBe(4);
  });

  it('is a whole number of kilograms', () => {
    for (const holes of [1, 2, 3, 5, 7, 9]) {
      const kg = defaultChargeKg(0, holes, 6.3, CHARGE_DEFAULT_STEMMING_M);
      expect(Number.isInteger(kg)).toBe(true);
    }
  });

  it('a lone shallow-capacity hole is bound by the hole, not the permit', () => {
    // one 5 m hole: the hole takes 5 kg at 2.5 m stemming, the 40 kg permit takes far more
    expect(defaultChargeKg(0, 1, 5, CHARGE_DEFAULT_STEMMING_M)).toBe(5);
  });

  it('a deep single hole is bound by the permit when the hole takes more', () => {
    const kg = defaultChargeKg(0, 1, 40, CHARGE_DEFAULT_STEMMING_M);
    expect(kg).toBe(permitLimitsFor(0).maxChargeKg);
  });

  it('the shallowest hole sets the capacity: a shallower pattern gets a smaller default', () => {
    expect(defaultChargeKg(0, 4, 4, CHARGE_DEFAULT_STEMMING_M)).toBe(3);
    expect(defaultChargeKg(0, 4, 4, CHARGE_DEFAULT_STEMMING_M)).toBeLessThan(defaultChargeKg(0, 4, 5, CHARGE_DEFAULT_STEMMING_M));
  });

  it('more stemming leaves less room for charge', () => {
    expect(defaultChargeKg(0, 1, 5, 3)).toBeLessThan(defaultChargeKg(0, 1, 5, 2));
  });

  it('a fractional capacity rounds down to the whole kilogram', () => {
    // 7.2 m hole, 2.5 m stemming -> 4.7 m of column
    const kg = defaultChargeKg(1, 1, 7.2, CHARGE_DEFAULT_STEMMING_M);
    expect(kg).toBe(Math.floor(maxChargeKgForHole(7.2, CHARGE_DEFAULT_STEMMING_M)));
  });

  describe('falls back to the generic amount', () => {
    it('a site without a permit, whatever the pattern', () => {
      expect(defaultChargeKg(undefined, 9, 5, CHARGE_DEFAULT_STEMMING_M)).toBe(CHARGE_DEFAULT_AMOUNT_KG);
      expect(defaultChargeKg(undefined, 1, 30, CHARGE_DEFAULT_STEMMING_M)).toBe(7);
    });

    it.each([0, 1, 2])('no holes planned at grade %i', (grade) => {
      expect(defaultChargeKg(grade, 0, 5, CHARGE_DEFAULT_STEMMING_M)).toBe(7);
    });

    it('stemming that swallows the whole hole leaves nothing that fits', () => {
      expect(defaultChargeKg(0, 9, 2.5, CHARGE_DEFAULT_STEMMING_M)).toBe(CHARGE_DEFAULT_AMOUNT_KG);
      expect(defaultChargeKg(0, 9, 2, CHARGE_DEFAULT_STEMMING_M)).toBe(CHARGE_DEFAULT_AMOUNT_KG);
    });
  });

  describe('grades with a bigger permit derive the charge too', () => {
    it('grade 1, nine 8 m holes: the hole binds (permit allows more per hole)', () => {
      const kg = defaultChargeKg(1, 9, 8, CHARGE_DEFAULT_STEMMING_M);
      expect(kg).toBe(Math.floor(maxChargeKgForHole(8, CHARGE_DEFAULT_STEMMING_M)));
    });

    it('grade 1, sixteen 8 m holes: the 120 kg permit binds', () => {
      expect(defaultChargeKg(1, 16, 8, CHARGE_DEFAULT_STEMMING_M)).toBe(Math.floor(120 / 16));
    });

    it('a bigger permit never gives a smaller default for the same pattern', () => {
      expect(defaultChargeKg(2, 9, 8, CHARGE_DEFAULT_STEMMING_M))
        .toBeGreaterThanOrEqual(defaultChargeKg(0, 9, 8, CHARGE_DEFAULT_STEMMING_M));
    });
  });

  describe('hole diameter', () => {
    it('omitting the diameter equals the default rig diameter', () => {
      expect(defaultChargeKg(1, 4, 8, CHARGE_DEFAULT_STEMMING_M))
        .toBe(defaultChargeKg(1, 4, 8, CHARGE_DEFAULT_STEMMING_M, DRILL_HOLE_DEFAULT_DIAMETER_M));
    });

    it('a wider hole holds a different column weight, and the default follows it', () => {
      const wide = 0.15;
      const expected = Math.floor(maxChargeKgForHole(8, CHARGE_DEFAULT_STEMMING_M, wide));
      expect(expected).not.toBe(Math.floor(maxChargeKgForHole(8, CHARGE_DEFAULT_STEMMING_M)));
      expect(defaultChargeKg(2, 4, 8, CHARGE_DEFAULT_STEMMING_M, wide)).toBe(expected);
    });
  });

  describe('invariants over a sweep of patterns', () => {
    const cases: Array<[number, number, number]> = [];
    for (const grade of [0, 1, 2, 3]) {
      for (const holes of [1, 2, 4, 6, 9, 12, 16]) {
        for (const depth of [3.7, 5, 6.5, 8, 11.2]) cases.push([grade, holes, depth]);
      }
    }

    it('whenever a charge is derived, the hole takes it and the pattern stays inside the permit', () => {
      for (const [grade, holes, depth] of cases) {
        const kg = defaultChargeKg(grade, holes, depth, CHARGE_DEFAULT_STEMMING_M);
        const hole = maxChargeKgForHole(depth, CHARGE_DEFAULT_STEMMING_M);
        const permit = permitLimitsFor(grade).maxChargeKg;
        if (Math.min(Math.floor(hole), Math.floor(permit / holes)) < 1) continue;
        expect(kg, `grade ${grade} holes ${holes} depth ${depth}`).toBeLessThanOrEqual(hole + 1e-6);
        expect(kg * holes, `grade ${grade} holes ${holes} depth ${depth}`).toBeLessThanOrEqual(permit);
      }
    });

    it('the derived charge is the largest whole kg: one more would not fit', () => {
      for (const [grade, holes, depth] of cases) {
        const kg = defaultChargeKg(grade, holes, depth, CHARGE_DEFAULT_STEMMING_M);
        const hole = maxChargeKgForHole(depth, CHARGE_DEFAULT_STEMMING_M);
        const permit = permitLimitsFor(grade).maxChargeKg;
        if (Math.min(Math.floor(hole), Math.floor(permit / holes)) < 1) continue;
        const next = kg + 1;
        expect(next > hole + 1e-6 || next * holes > permit, `grade ${grade} holes ${holes} depth ${depth}`).toBe(true);
      }
    });
  });
});
