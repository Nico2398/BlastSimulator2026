import { describe, it, expect } from 'vitest';
import * as fit from '../../../src/core/mining/ExplosiveRockFit.js';
import { dominantRockAlongColumn, dominantRockUnderHole } from '../../../src/core/mining/ExplosiveRockFit.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import * as balance from '../../../src/core/config/balance.js';

function voxel(rocks: { rockId: string; coefficient: number }[]): VoxelData {
  return { composition: { rocks }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
}
const pure = (rockId: string): VoxelData => voxel([{ rockId, coefficient: 1 }]);

/** Fill the column (x,z) over y in [fromY, toY] inclusive. */
function fillColumn(grid: VoxelGrid, x: number, z: number, fromY: number, toY: number, rockId: string) {
  for (let y = fromY; y <= toY; y++) grid.setVoxel(x, y, z, pure(rockId));
}

describe('module surface (#2197)', () => {
  it('no longer exports the tier-shortfall helpers', () => {
    expect(Object.keys(fit)).not.toContain('tierShortfall');
    expect(Object.keys(fit)).not.toContain('tierThresholdFactor');
  });

  it('keeps the column-rock samplers', () => {
    expect(typeof fit.dominantRockAlongColumn).toBe('function');
    expect(typeof fit.dominantRockUnderHole).toBe('function');
  });

  it('balance no longer carries TIER_SHORTFALL_THRESHOLD_FACTOR', () => {
    expect(Object.keys(balance)).not.toContain('TIER_SHORTFALL_THRESHOLD_FACTOR');
  });
});

describe('dominantRockAlongColumn', () => {
  it('returns the rock and tier of a uniform column', () => {
    const grid = new VoxelGrid(8, 12);
    fillColumn(grid, 3, 3, 0, 9, 'obstiite');
    expect(dominantRockAlongColumn(grid, 3, 3, 10, 6)).toEqual({ rockId: 'obstiite', tier: 4 });
  });

  it('returns the most common dominant rock when layers differ', () => {
    const grid = new VoxelGrid(8, 12);
    fillColumn(grid, 3, 3, 4, 7, 'molite');   // 4 layers
    fillColumn(grid, 3, 3, 8, 9, 'titanite'); // 2 layers, harder
    expect(dominantRockAlongColumn(grid, 3, 3, 10, 6)).toEqual({ rockId: 'molite', tier: 2 });
  });

  it('breaks a tie toward the higher tier, whichever layer holds it', () => {
    const upperHard = new VoxelGrid(8, 12);
    fillColumn(upperHard, 3, 3, 4, 6, 'cruite');
    fillColumn(upperHard, 3, 3, 7, 9, 'gnarlite');
    expect(dominantRockAlongColumn(upperHard, 3, 3, 10, 6)?.rockId).toBe('gnarlite');

    const lowerHard = new VoxelGrid(8, 12);
    fillColumn(lowerHard, 3, 3, 4, 6, 'gnarlite');
    fillColumn(lowerHard, 3, 3, 7, 9, 'cruite');
    expect(dominantRockAlongColumn(lowerHard, 3, 3, 10, 6)?.rockId).toBe('gnarlite');
  });

  it('ignores air layers when picking the mode', () => {
    const grid = new VoxelGrid(8, 12);
    fillColumn(grid, 3, 3, 8, 9, 'obstiite'); // only 2 of 6 layers are rock
    expect(dominantRockAlongColumn(grid, 3, 3, 10, 6)).toEqual({ rockId: 'obstiite', tier: 4 });
  });

  it('returns null when the whole column is air', () => {
    const grid = new VoxelGrid(8, 12);
    expect(dominantRockAlongColumn(grid, 3, 3, 10, 6)).toBeNull();
  });

  it('does not read neighbouring columns', () => {
    const grid = new VoxelGrid(8, 12);
    fillColumn(grid, 4, 3, 0, 9, 'titanite');
    expect(dominantRockAlongColumn(grid, 3, 3, 10, 6)).toBeNull();
  });
});

describe('dominantRockUnderHole', () => {
  it('samples from the ground surface down by the hole depth, flooring fractional hole positions', () => {
    const grid = new VoxelGrid(8, 12);
    fillColumn(grid, 3, 3, 0, 9, 'obstiite'); // surface at y = 10
    expect(dominantRockUnderHole(grid, { x: 3.4, z: 3.9, depth: 6 })).toEqual({ rockId: 'obstiite', tier: 4 });
  });
  it('returns null over an empty column', () => {
    expect(dominantRockUnderHole(new VoxelGrid(8, 12), { x: 2, z: 2, depth: 4 })).toBeNull();
  });
});
