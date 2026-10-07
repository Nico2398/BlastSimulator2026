import { describe, it, expect } from 'vitest';
import {
  tierShortfall, tierThresholdFactor, dominantRockTierAt, dominantRockAlongColumn,
} from '../../../src/core/mining/ExplosiveRockFit.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { TIER_SHORTFALL_THRESHOLD_FACTOR } from '../../../src/core/config/balance.js';

function voxel(rocks: { rockId: string; coefficient: number }[]): VoxelData {
  return { composition: { rocks }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
}
const pure = (rockId: string): VoxelData => voxel([{ rockId, coefficient: 1 }]);

/** Fill the column (x,z) over y in [fromY, toY] inclusive. */
function fillColumn(grid: VoxelGrid, x: number, z: number, fromY: number, toY: number, rockId: string) {
  for (let y = fromY; y <= toY; y++) grid.setVoxel(x, y, z, pure(rockId));
}

describe('tierShortfall', () => {
  it('is the number of tiers the rock outclasses the explosive', () => {
    expect(tierShortfall(1, 4)).toBe(3);
    expect(tierShortfall(3, 4)).toBe(1);
  });
  it('is 0 when the explosive tier equals the rock tier', () => {
    expect(tierShortfall(2, 2)).toBe(0);
  });
  it('is 0, never negative, when the explosive outclasses the rock', () => {
    expect(tierShortfall(4, 1)).toBe(0);
    expect(tierShortfall(5, 1)).toBe(0);
  });
  it('is 0 against air (tier 0)', () => {
    expect(tierShortfall(1, 0)).toBe(0);
  });
});

describe('tierThresholdFactor', () => {
  it('is 1 for no shortfall', () => {
    expect(tierThresholdFactor(0)).toBe(1);
  });
  it('is TIER_SHORTFALL_THRESHOLD_FACTOR ** shortfall', () => {
    for (const s of [1, 2, 3, 4]) {
      expect(tierThresholdFactor(s)).toBeCloseTo(TIER_SHORTFALL_THRESHOLD_FACTOR ** s, 6);
    }
  });
  it('is strictly increasing in the shortfall', () => {
    for (let s = 0; s < 4; s++) {
      expect(tierThresholdFactor(s + 1)).toBeGreaterThan(tierThresholdFactor(s));
    }
  });
});

describe('dominantRockTierAt', () => {
  it('returns the hardness tier of a pure rock voxel', () => {
    const grid = new VoxelGrid(8, 8);
    grid.setVoxel(2, 2, 2, pure('obstiite'));
    grid.setVoxel(3, 2, 2, pure('cruite'));
    expect(dominantRockTierAt(grid, 2, 2, 2)).toBe(4);
    expect(dominantRockTierAt(grid, 3, 2, 2)).toBe(1);
  });
  it('uses the rock with the largest coefficient in a mixed voxel', () => {
    const grid = new VoxelGrid(8, 8);
    grid.setVoxel(1, 1, 1, voxel([{ rockId: 'cruite', coefficient: 0.3 }, { rockId: 'titanite', coefficient: 0.7 }]));
    expect(dominantRockTierAt(grid, 1, 1, 1)).toBe(5);
  });
  it('returns 0 for air', () => {
    const grid = new VoxelGrid(8, 8);
    expect(dominantRockTierAt(grid, 4, 4, 4)).toBe(0);
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
