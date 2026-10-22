// BlastSimulator2026 — Unit tests: ramp steepness against the one vehicle limit (#1938, #2045)

import { describe, it, expect } from 'vitest';
import { rampSteepestGradeDegrees, steepestBlockingRamp, describeRampClimbability } from '../../../src/core/mining/RampGrade.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { installGradedRamps, buildGradedRampGrid, gradedBuiltRamp } from '../../helpers/gradedRamps.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { rampPathCells, rampBoundingFootprint } from '../../../src/core/mining/RampPath.js';
import type { BuiltRamp } from '../../../src/core/state/GameState.js';
import { slopeRatioForDegrees } from '../../../src/core/nav/ClimbLimit.js';
import { VEHICLE_MAX_SLOPE_RATIO } from '../../../src/core/config/balance.js';

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
  const LIMIT = VEHICLE_MAX_SLOPE_RATIO;

  it('returns the 26 degree ramp when the 20 degree vehicle limit is asked of it', () => {
    const state = stateWith([26]);
    expect(steepestBlockingRamp(state, LIMIT)?.ramp.id).toBe(1);
  });

  it('returns null when every ramp is within the limit', () => {
    const state = stateWith([15, 20]);
    expect(steepestBlockingRamp(state, LIMIT)).toBeNull();
  });

  it('returns the steepest of several blocking ramps', () => {
    const state = stateWith([25, 30, 15]);
    expect(steepestBlockingRamp(state, LIMIT)?.ramp.id).toBe(2);
  });

  it('ignores a ramp the limit allows even when a steeper one blocks', () => {
    const state = stateWith([20, 26]);
    expect(steepestBlockingRamp(state, LIMIT)?.ramp.id).toBe(2);
    expect(steepestBlockingRamp(state, slopeRatioForDegrees(30))).toBeNull();
  });

  it('returns null with no built ramps', () => {
    const state = createGame({ seed: 42 });
    expect(steepestBlockingRamp(state, LIMIT)).toBeNull();
  });

  it('returns null without a nav grid', () => {
    const state = stateWith([30]);
    state.navGrid = null;
    expect(steepestBlockingRamp(state, LIMIT)).toBeNull();
  });
});

describe('describeRampClimbability (#2045)', () => {
  const climb = (deg: number, progression = true) => {
    const state = stateWith([deg]);
    return describeRampClimbability(state.navGrid!, state.builtRamps[0]!, progression);
  };

  it('a 26 degree ramp is not climbable and reports the 20 degree limit', () => {
    const out = climb(26)!;
    expect(out.gradeDeg).toBeCloseTo(26, 3);
    expect(out.climbable).toBe(false);
    expect(out.maxDeg).toBe(20);
  });

  it('a 15 degree ramp is climbable', () => {
    const out = climb(15)!;
    expect(out.gradeDeg).toBeCloseTo(15, 3);
    expect(out.climbable).toBe(true);
    expect(out.maxDeg).toBe(20);
  });

  it('a 20 degree ramp is climbable: the limit is inclusive', () => {
    expect(climb(20)!.climbable).toBe(true);
  });

  it('a hair over the limit is not climbable', () => {
    expect(climb(21)!.climbable).toBe(false);
  });

  it('a 30 degree ramp is not climbable on a progression site, whatever the old tier 1 said', () => {
    expect(climb(30)!.climbable).toBe(false);
  });

  it('returns null without a nav grid', () => {
    const state = stateWith([15]);
    expect(describeRampClimbability(null as never, state.builtRamps[0]!, true)).toBeNull();
  });

  it('has no tier list in its result', () => {
    expect(Object.keys(climb(15)!).sort()).toEqual(['climbable', 'gradeDeg', 'maxDeg']);
  });
});

// ── #1939: multi-leg ramps ──

describe('rampSteepestGradeDegrees on a multi-leg ramp (#1939)', () => {
  const LEGS = [{ direction: 'south' as const, length: 8 }, { direction: 'east' as const, length: 8 }];
  const PATH = { originX: 3, originZ: 3, legs: LEGS };
  const DEG = 15;

  function lGrid(): NavGrid {
    const cells: NavCell[][] = [];
    for (let z = 0; z < 20; z++) {
      const row: NavCell[] = [];
      for (let x = 0; x < 20; x++) row.push({ type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false, surfaceY: 50, climbY: 50 });
      cells.push(row);
    }
    for (const c of rampPathCells(PATH, 3)) {
      const y = c.step * Math.tan((DEG * Math.PI) / 180);
      cells[c.z]![c.x] = { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false, surfaceY: y, climbY: y };
    }
    return new NavGrid(20, 20, cells, 50);
  }

  function lRamp(): BuiltRamp {
    const def = { originX: 3, originZ: 3, direction: 'south' as const, length: 16, targetDepth: 4, width: 3 as const, legs: LEGS };
    return { id: 1, width: 3, def, footprint: rampBoundingFootprint(PATH, 3) };
  }

  it('measures the grade along the path, not the cliff beside it', () => {
    const g = rampSteepestGradeDegrees(lGrid(), lRamp());
    expect(g).toBeGreaterThan(DEG - 1);
    expect(g).toBeLessThan(DEG + 5);
  });

  it('is not fooled by the empty corner of the bounding box', () => {
    expect(rampSteepestGradeDegrees(lGrid(), lRamp())).toBeLessThan(DEG + 5);
  });
});
