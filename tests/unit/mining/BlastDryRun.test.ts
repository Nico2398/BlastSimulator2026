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

/** One 4.5 m hole with 1 kg of pop_rock under 1.5 m of stemming: just enough to break out. */
function boulderShot(): BlastPlan {
  const holes = createGridPlan({ nextHoleId: 1 }, { x: 14, z: 14 }, 1, 1, 4, 4.5, 0.089);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, 'pop_rock', 1, 1.5);
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
    // A charge that barely breaks out lifts its collar whole: one 3.75 m³ boulder beside two small
    // pieces (measured: 1 of 3 fragments above OVERSIZED_FRAGMENT_THRESHOLD 2.0 m³, 33% > the 30%
    // BLAST_OVERSIZE_SHARE_CAP; 1 of 3 at 4 m and 5 m deep too). At the 2.0 m³ threshold no
    // multi-hole pattern on this bench reaches the cap: the best measured was 27% (2x2, 1 kg holes),
    // and the 3x3 of 8 m pop_rock holes this test used before leaves 4-8%.
    const plan = boulderShot();
    const bench = () => buildWallGrid({ plateauTop: 20 });
    const real = executeBlast(plan, bench(), [], GROUND)!;
    const report = buildBlastReport(real, 0, 0);
    expect(report.ratingCap).toBe('oversize');
    expect(real.rating).toBe('perfect');
    const forecast = dryRunBlast(plan, bench(), [], GROUND, NO_WET)!;
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

describe('dryRunBlast — fragment distribution (#2201)', () => {
  it('carries the real blast band volumes, oversized count and dust loss (fresh ground)', () => {
    const plan = standardShot().plan;
    const forecast = dryRunBlast(plan, buildWallGrid({ plateauTop: 20 }), [], GROUND, NO_WET)!;
    const real = executeBlast(plan, buildWallGrid({ plateauTop: 20 }), [], GROUND)!;
    expect(forecast.bandVolumes).toEqual(real.bandVolumes);
    expect(forecast.oversizedFragments).toBe(real.oversizedFragments);
    expect(forecast.dustLossMassKg).toBeCloseTo(real.dustLoss.massKg, 6);
    expect(forecast.dustLossValue).toBeCloseTo(real.dustLoss.oreValue, 6);
  });

  it('carries them beside a crater too', () => {
    const a = craterGrid();
    const b = craterGrid();
    const forecast = dryRunBlast(a.second, a.grid, [], GROUND, NO_WET)!;
    const real = executeBlast(b.second, b.grid, [], GROUND)!;
    expect(forecast.bandVolumes).toEqual(real.bandVolumes);
    expect(forecast.oversizedFragments).toBe(real.oversizedFragments);
  });

  it('has a volume for every fragmentation band, none negative', () => {
    const forecast = dryRunBlast(standardShot().plan, buildWallGrid({ plateauTop: 20 }), [], GROUND, NO_WET)!;
    expect(Object.keys(forecast.bandVolumes).sort()).toEqual(['coarse', 'cracked', 'dust', 'fines', 'good', 'intact']);
    for (const v of Object.values(forecast.bandVolumes)) expect(v).toBeGreaterThanOrEqual(0);
    expect(forecast.dustLossMassKg).toBeGreaterThanOrEqual(0);
    expect(forecast.dustLossValue).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(forecast.oversizedFragments)).toBe(true);
  });

  it('a no-hole plan has no forecast to read a distribution from', () => {
    expect(dryRunBlast(assembleBlastPlan([], {}), buildWallGrid({ plateauTop: 20 }), [], GROUND, NO_WET)).toBeNull();
  });
});

describe('isHazardRating', () => {
  it.each<[BlastRating, boolean]>([
    ['perfect', false], ['good', false], ['mediocre', false], ['bad', true], ['catastrophic', true],
  ])('%s -> %s', (rating, expected) => {
    expect(isHazardRating(rating)).toBe(expected);
  });
});
