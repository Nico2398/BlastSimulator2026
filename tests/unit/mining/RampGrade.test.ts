// BlastSimulator2026 — Unit tests: ramp steepness against vehicle tier limits (#1938)

import { describe, it, expect } from 'vitest';
import { rampSteepestGradeDegrees, steepestBlockingRamp, describeRampClimb } from '../../../src/core/mining/RampGrade.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { installGradedRamps, buildGradedRampGrid, gradedBuiltRamp } from '../../helpers/gradedRamps.js';
import { tierSlopeRatio } from '../../../src/core/nav/ClimbLimit.js';

function stateWith(degrees: number[]): GameState {
  const state = createGame({ seed: 42 });
  installGradedRamps(state, degrees);
  return state;
}

describe('rampSteepestGradeDegrees', () => {
  it('measures the steepest step of a 30 degree ramp', () => {
    const grid = buildGradedRampGrid([30]);
    expect(rampSteepestGradeDegrees(grid, gradedBuiltRamp(0, 30))).toBeCloseTo(30, 3);
  });

  it('measures a gentle 15 degree ramp', () => {
    const grid = buildGradedRampGrid([15]);
    expect(rampSteepestGradeDegrees(grid, gradedBuiltRamp(0, 15))).toBeCloseTo(15, 3);
  });

  it('reads each ramp from its own footprint when two share a grid', () => {
    const grid = buildGradedRampGrid([30, 15]);
    expect(rampSteepestGradeDegrees(grid, gradedBuiltRamp(0, 30))).toBeCloseTo(30, 3);
    expect(rampSteepestGradeDegrees(grid, gradedBuiltRamp(1, 15))).toBeCloseTo(15, 3);
  });

  it('a footprint over flat ground reads 0 degrees', () => {
    const grid = buildGradedRampGrid([30]);
    const flat = { ...gradedBuiltRamp(0, 30), footprint: { minX: 0, maxX: 2, minZ: 1, maxZ: 3 } };
    expect(rampSteepestGradeDegrees(grid, flat)).toBe(0);
  });
});

describe('steepestBlockingRamp', () => {
  it('returns the 30 degree ramp when a tier-3 limit is asked of it', () => {
    const state = stateWith([30]);
    expect(steepestBlockingRamp(state, tierSlopeRatio(3))?.ramp.id).toBe(1);
  });

  it('returns null when every ramp is within the limit', () => {
    const state = stateWith([15]);
    expect(steepestBlockingRamp(state, tierSlopeRatio(3))).toBeNull();
  });

  it('returns the steepest of several blocking ramps', () => {
    const state = stateWith([25, 30, 15]);
    expect(steepestBlockingRamp(state, tierSlopeRatio(3))?.ramp.id).toBe(2);
  });

  it('ignores a ramp the limit allows even when a steeper one blocks', () => {
    const state = stateWith([20, 15]);
    expect(steepestBlockingRamp(state, tierSlopeRatio(2))).toBeNull();
    expect(steepestBlockingRamp(state, tierSlopeRatio(3))?.ramp.id).toBe(1);
  });

  it('returns null with no built ramps', () => {
    const state = createGame({ seed: 42 });
    expect(steepestBlockingRamp(state, tierSlopeRatio(3))).toBeNull();
  });

  it('returns null without a nav grid', () => {
    const state = stateWith([30]);
    state.navGrid = null;
    expect(steepestBlockingRamp(state, tierSlopeRatio(3))).toBeNull();
  });
});

describe('describeRampClimb', () => {
  it('a 30 degree ramp on a progression site is climbable by tier 1 only', () => {
    const state = stateWith([30]);
    const out = describeRampClimb(state.navGrid!, state.builtRamps[0]!, true);
    expect(out.gradeDeg).toBeCloseTo(30, 3);
    expect(out.tiers).toEqual([1]);
  });

  it('a 15 degree ramp on a progression site is climbable by every tier', () => {
    const state = stateWith([15]);
    const out = describeRampClimb(state.navGrid!, state.builtRamps[0]!, true);
    expect(out.gradeDeg).toBeCloseTo(15, 3);
    expect(out.tiers).toEqual([1, 2, 3]);
  });

  it('a 20 degree ramp on a progression site is climbable by tiers 1 and 2', () => {
    const state = stateWith([20]);
    expect(describeRampClimb(state.navGrid!, state.builtRamps[0]!, true).tiers).toEqual([1, 2]);
  });

  it('outside a progression site every tier climbs the ramp, whatever its grade', () => {
    const state = stateWith([30]);
    const out = describeRampClimb(state.navGrid!, state.builtRamps[0]!, false);
    expect(out.gradeDeg).toBeCloseTo(30, 3);
    expect(out.tiers).toEqual([1, 2, 3]);
  });
});
