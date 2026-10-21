// BlastSimulator2026 — Unit tests: per-vehicle-tier climb limits (#1938)

import { describe, it, expect } from 'vitest';
import {
  slopeRatioForDegrees, slopeDegreesForTier, tierSlopeRatio, tiersThatClimb, slowestVehicleTierSlopeRatio, VEHICLE_TIER_LIST,
} from '../../../src/core/nav/ClimbLimit.js';
import { NAV_MAX_SLOPE_RATIO, VEHICLE_TIER_MAX_SLOPE_DEGREES } from '../../../src/core/config/balance.js';

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

describe('slopeDegreesForTier', () => {
  it('reads 30 / 24 / 18 degrees for tiers 1 / 2 / 3', () => {
    expect(slopeDegreesForTier(1)).toBe(30);
    expect(slopeDegreesForTier(2)).toBe(24);
    expect(slopeDegreesForTier(3)).toBe(18);
  });

  it('agrees with the balance table for every tier', () => {
    for (const tier of [1, 2, 3] as const) expect(slopeDegreesForTier(tier)).toBe(VEHICLE_TIER_MAX_SLOPE_DEGREES[tier]);
  });
});

describe('tierSlopeRatio', () => {
  it('tier 1 keeps the global limit', () => {
    expect(tierSlopeRatio(1)).toBeCloseTo(NAV_MAX_SLOPE_RATIO, 12);
  });

  it('shrinks strictly with tier', () => {
    expect(tierSlopeRatio(2)).toBeLessThan(tierSlopeRatio(1));
    expect(tierSlopeRatio(3)).toBeLessThan(tierSlopeRatio(2));
  });

  it('tier 3 is tan(18 degrees)', () => {
    expect(tierSlopeRatio(3)).toBeCloseTo(Math.tan(18 * Math.PI / 180), 12);
  });
});

describe('tiersThatClimb', () => {
  it('a gentle 15 degree grade is climbable by every tier', () => {
    expect(tiersThatClimb(15)).toEqual([1, 2, 3]);
  });

  it('a 20 degree grade is climbable by tiers 1 and 2 only', () => {
    expect(tiersThatClimb(20)).toEqual([1, 2]);
  });

  it('a 30 degree grade is climbable by tier 1 only', () => {
    expect(tiersThatClimb(30)).toEqual([1]);
  });

  it('a flat grade is climbable by every tier', () => {
    expect(tiersThatClimb(0)).toEqual([1, 2, 3]);
  });

  it('boundary: exactly each tier limit is inclusive, a hair over drops that tier', () => {
    expect(tiersThatClimb(18)).toEqual([1, 2, 3]);
    expect(tiersThatClimb(18.5)).toEqual([1, 2]);
    expect(tiersThatClimb(24)).toEqual([1, 2]);
    expect(tiersThatClimb(24.5)).toEqual([1]);
  });

  it('a grade past 30 degrees is climbable by nobody', () => {
    expect(tiersThatClimb(31)).toEqual([]);
  });
});

describe('slowestVehicleTierSlopeRatio (#2044)', () => {
  it('is the smallest tier ratio, as a tangent of the smallest tier angle', () => {
    const smallest = Math.min(...VEHICLE_TIER_LIST.map(slopeDegreesForTier));
    expect(slowestVehicleTierSlopeRatio()).toBeCloseTo(slopeRatioForDegrees(smallest), 12);
    expect(slowestVehicleTierSlopeRatio()).toBeCloseTo(Math.min(...VEHICLE_TIER_LIST.map(tierSlopeRatio)), 12);
  });

  it('is strictly below the walking limit, since some tier climbs less than walkers', () => {
    expect(slowestVehicleTierSlopeRatio()).toBeLessThan(NAV_MAX_SLOPE_RATIO);
  });

  it('is climbable by every tier: no tier is limited below it', () => {
    for (const tier of VEHICLE_TIER_LIST) expect(tierSlopeRatio(tier)).toBeGreaterThanOrEqual(slowestVehicleTierSlopeRatio() - 1e-12);
  });

  it('matches the VEHICLE_TIER_MAX_SLOPE_DEGREES minimum', () => {
    expect(slowestVehicleTierSlopeRatio()).toBeCloseTo(slopeRatioForDegrees(Math.min(...Object.values(VEHICLE_TIER_MAX_SLOPE_DEGREES))), 12);
  });
});
