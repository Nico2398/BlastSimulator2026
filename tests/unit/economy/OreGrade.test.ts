// BlastSimulator2026 — Unit tests: ore grade scale lever (#1932)
import { describe, it, expect } from 'vitest';
import { isValidOreGradeScale, oreGradeScaleOf, scaledGradeThreshold } from '../../../src/core/economy/OreGrade.js';
import { fragmentHaulUrgency } from '../../../src/core/economy/OreDemand.js';
import { ORE_DEMAND_FULL_GRADE, ORE_DEMAND_MIN_GRADE } from '../../../src/core/config/balance.js';

describe('oreGradeScaleOf (#1932)', () => {
  it('returns the world scale when set', () => {
    expect(oreGradeScaleOf({ oreGradeScale: 0.2 })).toBe(0.2);
  });

  it('defaults to 1 when the world has no scale', () => {
    expect(oreGradeScaleOf({})).toBe(1);
  });

  it('defaults to 1 for a null or undefined world', () => {
    expect(oreGradeScaleOf(null)).toBe(1);
    expect(oreGradeScaleOf(undefined)).toBe(1);
  });

  it('keeps the upper bound 1 as is', () => {
    expect(oreGradeScaleOf({ oreGradeScale: 1 })).toBe(1);
  });
});

describe('scaledGradeThreshold (#1932)', () => {
  it('multiplies the base by the scale', () => {
    expect(scaledGradeThreshold(0.5, 0.2)).toBeCloseTo(0.1, 12);
  });

  it('is the identity at scale 1', () => {
    expect(scaledGradeThreshold(0.05, 1)).toBe(0.05);
  });

  it('a zero base stays zero', () => {
    expect(scaledGradeThreshold(0, 0.2)).toBe(0);
  });
});

describe('fragmentHaulUrgency with a grade scale (#1932)', () => {
  const urgency = new Map([['rustite', 1]]);
  const S = 0.2;

  it('a fragment scaled by s at gradeScale s weighs the same as the unscaled one at scale 1', () => {
    for (const d of [0.1, 0.25, 0.4, 0.5, 0.9]) {
      expect(fragmentHaulUrgency({ rustite: d * S }, urgency, S)).toBeCloseTo(fragmentHaulUrgency({ rustite: d }, urgency, 1), 10);
    }
  });

  it('a full-grade fragment scaled by s reaches the full weight', () => {
    expect(fragmentHaulUrgency({ rustite: ORE_DEMAND_FULL_GRADE * S }, urgency, S)).toBeCloseTo(1, 10);
  });

  it('a trace fragment below the relative minimum earns 0', () => {
    expect(fragmentHaulUrgency({ rustite: ORE_DEMAND_MIN_GRADE * S * 0.5 }, urgency, S)).toBe(0);
  });

  it('a fragment at the relative minimum earns a positive weight', () => {
    expect(fragmentHaulUrgency({ rustite: ORE_DEMAND_MIN_GRADE * S * 1.01 }, urgency, S)).toBeGreaterThan(0);
  });

  it('without the scale, a scaled fragment would be weighted lower than with it', () => {
    const d = 0.3 * S;
    expect(fragmentHaulUrgency({ rustite: d }, urgency, S)).toBeGreaterThan(fragmentHaulUrgency({ rustite: d }, urgency, 1));
  });

  it('scale 1 equals the default argument', () => {
    expect(fragmentHaulUrgency({ rustite: 0.3 }, urgency, 1)).toBe(fragmentHaulUrgency({ rustite: 0.3 }, urgency));
  });
});

describe('isValidOreGradeScale (#1932)', () => {
  it.each([0.01, 0.2, 1])('accepts %s', v => expect(isValidOreGradeScale(v)).toBe(true));
  it.each([0, -0.1, 1.5, NaN, Infinity])('rejects %s', v => expect(isValidOreGradeScale(v)).toBe(false));
});
