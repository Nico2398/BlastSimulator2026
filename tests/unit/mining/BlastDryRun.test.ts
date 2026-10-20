import { describe, it, expect, vi, afterEach } from 'vitest';
import { dryRunBlast } from '../../../src/core/mining/BlastDryRun.js';
import { isHazardRating } from '../../../src/core/mining/BlastRatingCaps.js';
import { executeBlast, buildBlastReport, type BlastRating } from '../../../src/core/mining/BlastExecution.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan, type BlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { buildWallGrid, standardShot } from '../../helpers/wallWarningFixture.js';
import { vec3 } from '../../../src/core/math/Vec3.js';
import type { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

afterEach(() => { vi.restoreAllMocks(); });

const GROUND = 1;
const NO_WET: ReadonlySet<string> = new Set();

function snapshot(grid: VoxelGrid): string {
  const out: unknown[] = [];
  for (let z = 0; z < 40; z++)
    for (let x = 0; x < 40; x++)
      for (let y = 0; y < 28; y++) out.push(grid.getVoxel(x, y, z) ?? null);
  return JSON.stringify(out);
}

function shotAt(x: number, z: number, idStart: number): BlastPlan {
  const counter = { nextHoleId: idStart };
  const holes = createGridPlan(counter, { x, z }, 3, 3, 4, 8, 0.089);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, 'krackle', 8, 2.5);
  return assembleBlastPlan(holes, charges);
}

/** Flat 20 m bench; a first 3x3 shot is fired, leaving a crater the second shot sits beside. */
function craterGrid(): { grid: VoxelGrid; second: BlastPlan } {
  const grid = buildWallGrid({ plateauTop: 20 });
  executeBlast(standardShot().plan, grid, [], GROUND);
  return { grid, second: shotAt(24, 16, 100) };
}

describe('dryRunBlast', () => {
  it('leaves the grid voxels and edit log unchanged', () => {
    const grid = buildWallGrid({ plateauTop: 20 });
    const before = snapshot(grid);
    const log = JSON.stringify(grid.edits.columns());
    const forecast = dryRunBlast(standardShot().plan, grid, [], GROUND, NO_WET);
    expect(forecast).not.toBeNull();
    expect(snapshot(grid)).toBe(before);
    expect(JSON.stringify(grid.edits.columns())).toBe(log);
  });

  it('emits no events', () => {
    const spy = vi.spyOn(EventEmitter.prototype, 'emit');
    dryRunBlast(standardShot().plan, buildWallGrid({ plateauTop: 20 }), [], GROUND, NO_WET);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null for an invalid plan (no holes)', () => {
    const grid = buildWallGrid({ plateauTop: 20 });
    expect(dryRunBlast(assembleBlastPlan([], {}), grid, [], GROUND, NO_WET)).toBeNull();
  });

  it('is repeatable: two dry-runs on the same grid agree', () => {
    const grid = buildWallGrid({ plateauTop: 20 });
    const plan = standardShot().plan;
    expect(dryRunBlast(plan, grid, [], GROUND, NO_WET)).toEqual(dryRunBlast(plan, grid, [], GROUND, NO_WET));
  });

  it('fresh ground: predicted rating equals the executed rating, nothing thrown', () => {
    const plan = standardShot().plan;
    const forecast = dryRunBlast(plan, buildWallGrid({ plateauTop: 20 }), [], GROUND, NO_WET)!;
    const real = executeBlast(plan, buildWallGrid({ plateauTop: 20 }), [], GROUND)!;
    expect(forecast.rating).toBe(buildBlastReport(real, 0, 0).rating);
    expect(forecast.projectionCount).toBe(0);
    expect(forecast.thrownShare).toBe(0);
    expect(forecast.furthestThrowM).toBe(0);
  });

  it('beside a crater: rating, thrown count, total fragments and furthest throw match executeBlast', () => {
    const a = craterGrid();
    const b = craterGrid();
    const forecast = dryRunBlast(a.second, a.grid, [], GROUND, NO_WET)!;
    const real = executeBlast(b.second, b.grid, [], GROUND)!;
    expect(forecast.rating).toBe(buildBlastReport(real, 0, 0).rating);
    expect(forecast.projectionCount).toBe(real.projectionCount);
    expect(forecast.fragmentCount).toBe(real.fragmentCount);
    expect(Math.abs(forecast.furthestThrowM - real.maxThrowDistance)).toBeLessThanOrEqual(0.5);
    const share = real.fragmentCount > 0 ? real.projectionCount / real.fragmentCount : 0;
    expect(forecast.thrownShare).toBeCloseTo(share, 6);
  });

  it('applies the oversize rating cap: forecast equals the report rating, below the base rating', () => {
    const plan = standardShot().plan;
    const real = executeBlast(plan, buildWallGrid({ plateauTop: 20 }), [], GROUND)!;
    const report = buildBlastReport(real, 0, 0);
    expect(report.ratingCap).toBe('oversize');
    expect(real.rating).toBe('perfect');
    const forecast = dryRunBlast(plan, buildWallGrid({ plateauTop: 20 }), [], GROUND, NO_WET)!;
    expect(forecast.rating).toBe('good');
    expect(forecast.rating).toBe(report.rating);
  });

  it('clearedVoxels equals executeBlast clearedVoxels', () => {
    const a = craterGrid();
    const b = craterGrid();
    expect(dryRunBlast(a.second, a.grid, [], GROUND, NO_WET)!.clearedVoxels).toBe(executeBlast(b.second, b.grid, [], GROUND)!.clearedVoxels);
  });

  it('counts villages like the real blast (vibration feeds the rating)', () => {
    const villages = [{ id: 'v', position: vec3(20, 0, 20) }];
    const plan = standardShot().plan;
    const forecast = dryRunBlast(plan, buildWallGrid({ plateauTop: 20 }), villages, GROUND, NO_WET)!;
    const real = executeBlast(plan, buildWallGrid({ plateauTop: 20 }), villages, GROUND)!;
    expect(forecast.rating).toBe(buildBlastReport(real, 0, 0).rating);
  });
});

describe('isHazardRating', () => {
  it.each<[BlastRating, boolean]>([
    ['perfect', false], ['good', false], ['mediocre', false], ['bad', true], ['catastrophic', true],
  ])('%s -> %s', (rating, expected) => {
    expect(isHazardRating(rating)).toBe(expected);
  });
});
