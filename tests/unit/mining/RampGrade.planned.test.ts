// BlastSimulator2026 — plannedRampGradeDegrees unit tests (#1942, #2045)

import { describe, it, expect } from 'vitest';
import * as rampGradeModule from '../../../src/core/mining/RampGrade.js';
import { plannedRampGradeDegrees } from '../../../src/core/mining/RampGrade.js';
import { rampGradeBoundsDegrees } from '../../../src/core/mining/Ramp.js';

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

describe('tier helpers are gone from RampGrade (#2045)', () => {
  it('exports neither climbTiersFor nor describeRampClimb', () => {
    const mod = rampGradeModule as Record<string, unknown>;
    expect(mod['climbTiersFor']).toBeUndefined();
    expect(mod['describeRampClimb']).toBeUndefined();
  });
});
