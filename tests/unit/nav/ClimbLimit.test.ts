// BlastSimulator2026 — Unit tests: slope converters (#2045)

import { describe, it, expect } from 'vitest';
import { slopeRatioForDegrees, slopeDegreesForRatio } from '../../../src/core/nav/ClimbLimit.js';
import { NAV_MAX_SLOPE_RATIO, VEHICLE_MAX_SLOPE_RATIO } from '../../../src/core/config/balance.js';

describe('slopeRatioForDegrees', () => {
  it('is the tangent of the angle', () => {
    expect(slopeRatioForDegrees(45)).toBeCloseTo(1, 9);
    expect(slopeRatioForDegrees(18)).toBeCloseTo(Math.tan(18 * Math.PI / 180), 12);
  });

  it('is 0 for a flat grade', () => {
    expect(slopeRatioForDegrees(0)).toBe(0);
  });

  it('reproduces the global walking limit at 30 degrees', () => {
    expect(slopeRatioForDegrees(30)).toBeCloseTo(NAV_MAX_SLOPE_RATIO, 12);
  });
});

describe('slopeDegreesForRatio', () => {
  it('inverts slopeRatioForDegrees', () => {
    for (const d of [0, 10, 20, 30, 45]) expect(slopeDegreesForRatio(slopeRatioForDegrees(d))).toBeCloseTo(d, 9);
  });

  it('reads the vehicle limit ratio as 20 degrees', () => {
    expect(slopeDegreesForRatio(VEHICLE_MAX_SLOPE_RATIO)).toBeCloseTo(20, 9);
  });
});

describe('tier helpers are gone (#2045)', () => {
  it('exports no per-tier slope helper', async () => {
    const mod = await import('../../../src/core/nav/ClimbLimit.js') as Record<string, unknown>;
    for (const name of ['slopeDegreesForTier', 'tierSlopeRatio', 'tiersThatClimb', 'slowestVehicleTierSlopeRatio']) {
      expect(mod[name]).toBeUndefined();
    }
  });
});
