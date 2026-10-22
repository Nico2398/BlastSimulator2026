// BlastSimulator2026 — Unit tests: the one vehicle climb limit (#2045)

import { describe, it, expect } from 'vitest';
import { vehicleMaxSlopeRatio } from '../../../src/core/entities/Vehicle.js';
import { NAV_MAX_SLOPE_RATIO, VEHICLE_MAX_SLOPE_DEGREES, VEHICLE_MAX_SLOPE_RATIO } from '../../../src/core/config/balance.js';
import { createGame, isProgressionSite } from '../../../src/core/state/GameState.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';

const deg = (d: number): number => Math.tan(d * Math.PI / 180);

describe('vehicleMaxSlopeRatio (#2045)', () => {
  it('on a progression site: one 20 degree limit, no tier argument', () => {
    expect(vehicleMaxSlopeRatio(true)).toBeCloseTo(deg(20), 12);
    expect(vehicleMaxSlopeRatio(true)).toBeCloseTo(VEHICLE_MAX_SLOPE_RATIO, 12);
  });

  it('the limit constant is 20 degrees', () => {
    expect(VEHICLE_MAX_SLOPE_DEGREES).toBe(20);
  });

  it('off a progression site: the global 30 degree limit', () => {
    expect(vehicleMaxSlopeRatio(false)).toBeCloseTo(NAV_MAX_SLOPE_RATIO, 12);
  });

  it('the progression limit is strictly below the walking limit', () => {
    expect(vehicleMaxSlopeRatio(true)).toBeLessThan(vehicleMaxSlopeRatio(false));
  });
});

describe('isProgressionSite', () => {
  it('is false for a campaign state with no grade', () => {
    expect(isProgressionSite(createGame({ seed: 42 }))).toBe(false);
  });

  it('is true once the state carries a grade, even grade 0', () => {
    const state = createGame({ seed: 42 });
    state.grade = createGradeState();
    expect(isProgressionSite(state)).toBe(true);
  });
});
