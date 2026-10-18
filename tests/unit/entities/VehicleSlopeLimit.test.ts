// BlastSimulator2026 — Unit tests: vehicle climb limit by tier (#1938)

import { describe, it, expect } from 'vitest';
import { vehicleMaxSlopeRatio } from '../../../src/core/entities/Vehicle.js';
import { NAV_MAX_SLOPE_RATIO } from '../../../src/core/config/balance.js';
import { createGame, isProgressionSite } from '../../../src/core/state/GameState.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';

const deg = (d: number): number => Math.tan(d * Math.PI / 180);

describe('vehicleMaxSlopeRatio', () => {
  it('on a progression site: tier 1 / 2 / 3 climb 30 / 24 / 18 degrees', () => {
    expect(vehicleMaxSlopeRatio({ tier: 1 }, true)).toBeCloseTo(deg(30), 12);
    expect(vehicleMaxSlopeRatio({ tier: 2 }, true)).toBeCloseTo(deg(24), 12);
    expect(vehicleMaxSlopeRatio({ tier: 3 }, true)).toBeCloseTo(deg(18), 12);
  });

  it('off a progression site: every tier keeps the global 30 degree limit', () => {
    for (const tier of [1, 2, 3] as const) {
      expect(vehicleMaxSlopeRatio({ tier }, false)).toBeCloseTo(NAV_MAX_SLOPE_RATIO, 12);
    }
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
