// BlastSimulator2026 — Unit tests: ramp cut ceiling follows the vehicle limit on progression sites (#2045)
//
// Contract: `rampCutSlopeRatio(progression)` is the steepest rise/run a ramp floor is cut at
// (limit x RAMP_CUT_SLOPE_MARGIN). `RampDef.cutSlopeRatio` carries it; validateRampOrder,
// computeMinimumRampLength and
// rampGradeBoundsDegrees (trailing optional `cutSlopeRatio`) honour it. Undefined = the old 30 degree behaviour.

import { describe, it, expect } from 'vitest';
import {
  rampCutSlopeRatio, validateRampOrder, computeMinimumRampLength,
  rampGradeBoundsDegrees, type RampDef,
} from '../../../src/core/mining/Ramp.js';
import {
  RAMP_CUT_SLOPE_MARGIN, RAMP_CUT_SLOPE_RATIO, RAMP_MAX_DEPTH_M, VEHICLE_MAX_SLOPE_DEGREES,
} from '../../../src/core/config/balance.js';

const tanDeg = (d: number): number => Math.tan(d * Math.PI / 180);
const PROGRESSION = tanDeg(20) * 0.98;
const WALKING = tanDeg(30) * 0.98;
const BASE: RampDef = { originX: 10, originZ: 10, direction: 'south', length: 10, targetDepth: 5 };

describe('rampCutSlopeRatio (#2045)', () => {
  it('progression: tan(20 degrees) with the cut margin', () => {
    expect(rampCutSlopeRatio(true)).toBeCloseTo(PROGRESSION, 12);
    expect(rampCutSlopeRatio(true)).toBeCloseTo(tanDeg(VEHICLE_MAX_SLOPE_DEGREES) * RAMP_CUT_SLOPE_MARGIN, 12);
  });

  it('off progression: tan(30 degrees) with the cut margin, the old global ratio', () => {
    expect(rampCutSlopeRatio(false)).toBeCloseTo(WALKING, 12);
    expect(rampCutSlopeRatio(false)).toBeCloseTo(RAMP_CUT_SLOPE_RATIO, 12);
  });

  it('progression cuts strictly gentler than walking', () => {
    expect(rampCutSlopeRatio(true)).toBeLessThan(rampCutSlopeRatio(false));
  });
});

describe('RAMP_MAX_DEPTH_M (#2045)', () => {
  it('reaches the deepest ore, 55 m', () => {
    expect(RAMP_MAX_DEPTH_M).toBe(55);
  });
});

describe('computeMinimumRampLength with a cut ratio (#2045)', () => {
  it('uses the given ratio', () => {
    expect(computeMinimumRampLength(10, PROGRESSION)).toBeCloseTo(10 / PROGRESSION, 10);
  });

  it('a progression ramp needs more length than a walking one for the same depth', () => {
    expect(computeMinimumRampLength(10, PROGRESSION)).toBeGreaterThan(computeMinimumRampLength(10, WALKING));
  });

  it('defaults to the old ratio when none is given', () => {
    expect(computeMinimumRampLength(10)).toBeCloseTo(10 / RAMP_CUT_SLOPE_RATIO, 10);
  });

  it('zero depth needs zero length at any ratio', () => {
    expect(computeMinimumRampLength(0, PROGRESSION)).toBe(0);
  });
});

describe('rampGradeBoundsDegrees with a cut ratio (#2045)', () => {
  it('max is the real ceiling: 19.6 degrees-ish on progression, unchanged without a ratio', () => {
    expect(rampGradeBoundsDegrees(40, 10, PROGRESSION).max).toBeCloseTo(Math.atan(PROGRESSION) * 180 / Math.PI, 9);
    expect(rampGradeBoundsDegrees(40, 10, PROGRESSION).max).toBeLessThan(20);
    expect(rampGradeBoundsDegrees(40, 10).max).toBeCloseTo(Math.atan(RAMP_CUT_SLOPE_RATIO) * 180 / Math.PI, 9);
  });

  it('min does not depend on the ratio', () => {
    expect(rampGradeBoundsDegrees(40, 10, PROGRESSION).min).toBeCloseTo(rampGradeBoundsDegrees(40, 10).min, 12);
  });
});

describe('validateRampOrder honours RampDef.cutSlopeRatio (#2045)', () => {
  // depth 8, ratio 0.8/ length 20: 0.4 slope. Choose depth/length between the two ceilings.
  const between: RampDef = { ...BASE, targetDepth: 8, length: 8 / (tanDeg(25)) };

  it('an order steeper than 20 degrees is refused on a progression def, accepted without a ratio', () => {
    expect(validateRampOrder({ ...between, cutSlopeRatio: PROGRESSION }, 50_000_000).success).toBe(false);
    expect(validateRampOrder(between, 50_000_000).success).toBe(true);
  });

  it('the refusal reports the real ceiling in maxDegrees, not 30', () => {
    const result = validateRampOrder({ ...between, cutSlopeRatio: PROGRESSION }, 50_000_000);
    expect(result.messageKey).toBe('mining.build_ramp.slope_too_steep');
    expect(result.messageParams?.maxDegrees).toBe(VEHICLE_MAX_SLOPE_DEGREES);
    expect(result.messageParams?.minLength).toBe(Math.ceil(8 / PROGRESSION));
  });

  it('the old-save refusal still names 30 degrees', () => {
    const result = validateRampOrder({ ...BASE, targetDepth: 8, length: 8 / tanDeg(35) }, 50_000_000);
    expect(result.messageParams?.maxDegrees).toBe(30);
  });

  it('a length at the progression minimum is accepted', () => {
    const length = 8 / PROGRESSION + 1e-6;
    expect(validateRampOrder({ ...BASE, targetDepth: 8, length, cutSlopeRatio: PROGRESSION }, 50_000_000).success).toBe(true);
  });

  it('a chosen grade over the progression ceiling is refused with the real max', () => {
    const def: RampDef = { ...BASE, targetDepth: 8, length: 30, gradeDegrees: 25, cutSlopeRatio: PROGRESSION };
    const result = validateRampOrder(def, 50_000_000);
    expect(result.success).toBe(false);
    expect(result.messageKey).toBe('mining.build_ramp.grade_too_steep');
    expect(Number(result.messageParams?.max)).toBeLessThan(20);
  });

  it('a chosen 25 degree grade is accepted on a def with no ratio (old save)', () => {
    const def: RampDef = { ...BASE, targetDepth: 8, length: 30, gradeDegrees: 25 };
    expect(validateRampOrder(def, 50_000_000).success).toBe(true);
  });
});
