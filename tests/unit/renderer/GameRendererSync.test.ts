// BlastSimulator2026 — buildSurveyOverlayOptions() unit tests (#770)
//
// buildSurveyOverlayOptions() currently runs its own manual top-down voxel
// scan to find each survey column's surface Y, using a stale
// `voxel.density > 0` threshold. computeVoxelColumnSurfaceY() (VoxelGrid.ts)
// is the canonical scan and uses the correct isSolidAt threshold
// (density >= 0.5). The two diverge on a fractional-density voxel (#458
// terrain overhaul introduced these), which is exactly what test 2 below
// pins down as a regression: it must fail against the current unfixed
// buildSurveyOverlayOptions() and pass once it delegates to
// computeVoxelColumnSurfaceY().

import { describe, it, expect } from 'vitest';
import { buildSurveyOverlayOptions } from '../../../src/renderer/GameRendererSync.js';
import { VoxelGrid, computeVoxelColumnSurfaceY } from '../../../src/core/world/VoxelGrid.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';
import type { GameState } from '../../../src/core/state/GameState.js';

function makeSurveyResult(overrides: Partial<SurveyResult> = {}): SurveyResult {
  return {
    id: 1,
    method: 'seismic',
    centerX: 5,
    centerZ: 5,
    completedTick: 0,
    surveyorId: 1,
    estimates: { '5,5': { sparkium: 0.5 } },
    confidence: 0.85,
    ...overrides,
  };
}

function makeState(surveyResults: SurveyResult[]): GameState {
  const state = createGame({ seed: 42, startingCash: 100_000 });
  state.surveyResults = surveyResults;
  return state;
}

describe('buildSurveyOverlayOptions()', () => {
  it('matches computeVoxelColumnSurfaceY for a fully-solid column', () => {
    const grid = new VoxelGrid(20, 8, 20);
    for (let y = 0; y <= 3; y++) {
      grid.fillVoxel(5, y, 5, 0, undefined, 1.0);
    }
    const state = makeState([makeSurveyResult()]);

    const options = buildSurveyOverlayOptions(state, grid);

    expect(options).not.toBeNull();
    const point = options!.points.find(p => p.x === 5 && p.z === 5);
    expect(point).toBeDefined();
    expect(point!.surfaceY).toBe(computeVoxelColumnSurfaceY(grid, 5, 5) + 1);
    expect(point!.surfaceY).toBe(4);
  });

  it('uses the isSolidAt (density >= 0.5) threshold on a fractional-density band, not density > 0', () => {
    const grid = new VoxelGrid(20, 8, 20);
    grid.fillVoxel(5, 0, 5, 0, undefined, 1.0);
    grid.fillVoxel(5, 1, 5, 0, undefined, 1.0);
    grid.fillVoxel(5, 2, 5, 0, undefined, 1.0);
    // Below the isSolidAt threshold (0.5) but above 0 — the old
    // `density > 0` scan would wrongly treat this voxel as solid.
    grid.fillVoxel(5, 3, 5, 0, undefined, 0.2);
    const state = makeState([makeSurveyResult()]);

    const options = buildSurveyOverlayOptions(state, grid);

    expect(options).not.toBeNull();
    const point = options!.points.find(p => p.x === 5 && p.z === 5);
    expect(point).toBeDefined();
    // Correct: topmost isSolidAt-true voxel (y=2) + 1 = 3.
    // The unfixed manual scan returns 4 (treats y=3's density 0.2 as solid).
    expect(point!.surfaceY).toBe(3);
    expect(point!.surfaceY).toBe(computeVoxelColumnSurfaceY(grid, 5, 5) + 1);
  });

  it('returns surfaceY 0 for a column with no solid voxel anywhere', () => {
    const grid = new VoxelGrid(20, 8, 20);
    // No fillVoxel calls on column (5,5) — stays air.
    const state = makeState([makeSurveyResult()]);

    const options = buildSurveyOverlayOptions(state, grid);

    expect(options).not.toBeNull();
    const point = options!.points.find(p => p.x === 5 && p.z === 5);
    expect(point).toBeDefined();
    expect(point!.surfaceY).toBe(0);
    expect(point!.surfaceY).toBe(computeVoxelColumnSurfaceY(grid, 5, 5) + 1);
  });

  it('clamps an out-of-bounds survey column the same way computeVoxelColumnSurfaceY does', () => {
    const grid = new VoxelGrid(20, 8, 20);
    grid.fillVoxel(5, 0, 5, 0, undefined, 1.0);
    const state = makeState([
      makeSurveyResult({ centerX: 1000, centerZ: 1000, estimates: { '1000,1000': { sparkium: 0.5 } } }),
    ]);

    const options = buildSurveyOverlayOptions(state, grid);

    expect(options).not.toBeNull();
    const point = options!.points.find(p => p.x === 1000 && p.z === 1000);
    expect(point).toBeDefined();
    expect(point!.surfaceY).toBe(computeVoxelColumnSurfaceY(grid, 1000, 1000) + 1);
  });

  it('returns null when no grid is bound', () => {
    const state = makeState([makeSurveyResult()]);
    expect(buildSurveyOverlayOptions(state, null)).toBeNull();
  });

  it('returns null when there are no survey results', () => {
    const grid = new VoxelGrid(20, 8, 20);
    const state = makeState([]);
    expect(buildSurveyOverlayOptions(state, grid)).toBeNull();
  });
});
