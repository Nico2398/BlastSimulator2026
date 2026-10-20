// BlastSimulator2026 — climbTiersFor / plannedRampGradeDegrees unit tests (#1942)

import { describe, it, expect } from 'vitest';
import { climbTiersFor, plannedRampGradeDegrees } from '../../../src/core/mining/RampGrade.js';
import { rampGradeBoundsDegrees } from '../../../src/core/mining/Ramp.js';
import { slopeDegreesForTier, tiersThatClimb, VEHICLE_TIER_LIST } from '../../../src/core/nav/ClimbLimit.js';

describe('climbTiersFor', () => {
  it('off a progression site every tier climbs, however steep', () => {
    expect(climbTiersFor(30, false)).toEqual([...VEHICLE_TIER_LIST]);
    expect(climbTiersFor(5, false)).toEqual([...VEHICLE_TIER_LIST]);
  });

  it('on a progression site a gentle grade is climbed by every tier', () => {
    expect(climbTiersFor(10, true)).toEqual([1, 2, 3]);
  });

  it('on a progression site a steep grade drops the weakest tiers', () => {
    expect(climbTiersFor(20, true)).toEqual([1, 2]);
    expect(climbTiersFor(slopeDegreesForTier(1), true)).toEqual([1]);
  });

  it('a grade exactly at a tier limit still counts as climbable', () => {
    expect(climbTiersFor(slopeDegreesForTier(3), true)).toEqual([1, 2, 3]);
    expect(climbTiersFor(slopeDegreesForTier(2), true)).toEqual([1, 2]);
  });

  it('a grade beyond every tier limit leaves no tier', () => {
    expect(climbTiersFor(slopeDegreesForTier(1) + 1, true)).toEqual([]);
  });

  it('agrees with tiersThatClimb on progression sites', () => {
    for (const g of [0, 10, 18, 18.5, 24, 25, 30, 35]) expect(climbTiersFor(g, true)).toEqual(tiersThatClimb(g));
  });
});

describe('plannedRampGradeDegrees', () => {
  it('a chosen grade wins', () => {
    expect(plannedRampGradeDegrees({ length: 20, targetDepth: 8, gradeDegrees: 15 })).toBe(15);
  });

  it('without a chosen grade it is the straight line to the target depth', () => {
    const deg = plannedRampGradeDegrees({ length: 20, targetDepth: 8 });
    expect(deg).toBeCloseTo(rampGradeBoundsDegrees(20, 8).min, 9);
    expect(deg).toBeCloseTo(Math.atan(8 / 20) * 180 / Math.PI, 9);
  });

  it('uses the total length of the legs of a multi-leg order, not def.length', () => {
    const def = {
      length: 12, targetDepth: 6,
      legs: [{ direction: 'south' as const, length: 12 }, { direction: 'east' as const, length: 10 }],
    };
    expect(plannedRampGradeDegrees(def)).toBeCloseTo(rampGradeBoundsDegrees(22, 6).min, 9);
  });

  it('a longer road is gentler than a shorter one at the same depth', () => {
    expect(plannedRampGradeDegrees({ length: 40, targetDepth: 8 })).toBeLessThan(plannedRampGradeDegrees({ length: 20, targetDepth: 8 }));
  });
});
