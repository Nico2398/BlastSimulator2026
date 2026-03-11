import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { buildRamp, RAMP_COST_PER_METER } from '../../../src/core/mining/Ramp.js';

function fillGrid(grid: VoxelGrid) {
  for (let z = 0; z < grid.sizeZ; z++)
    for (let y = 0; y < grid.sizeY; y++)
      for (let x = 0; x < grid.sizeX; x++)
        grid.setVoxel(x, y, z, { rockId: 'cruite', density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
}

describe('Ramp building', () => {
  it('buildRamp modifies voxel grid to create a sloped passage', () => {
    const grid = new VoxelGrid(20, 15, 20);
    fillGrid(grid);

    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 10, targetDepth: 8,
    }, 50000);

    expect(result.success).toBe(true);
    expect(result.voxelsCleared).toBeGreaterThan(0);

    // Check that voxels along the ramp path are cleared
    const startVoxel = grid.getVoxel(10, 0, 10);
    expect(startVoxel?.density).toBe(0);
  });

  it('ramp connects surface level to a lower elevation', () => {
    const grid = new VoxelGrid(20, 15, 30);
    fillGrid(grid);

    const result = buildRamp(grid, {
      originX: 10, originZ: 5, direction: 'south', length: 15, targetDepth: 10,
    }, 50000);

    expect(result.success).toBe(true);

    // At the start (step 0): should be cleared at y=0
    expect(grid.getVoxel(10, 0, 5)?.density).toBe(0);

    // At the end (step 14): should be cleared at y≈9 (depth 10 * 14/15 ≈ 9.3 → floor=9)
    expect(grid.getVoxel(10, 9, 19)?.density).toBe(0);
  });

  it('ramp building deducts cost from finances', () => {
    const grid = new VoxelGrid(20, 15, 20);
    fillGrid(grid);

    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 10, targetDepth: 8,
    }, 50000);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(10 * RAMP_COST_PER_METER);
  });

  it('fails with insufficient funds', () => {
    const grid = new VoxelGrid(20, 15, 20);
    fillGrid(grid);

    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 10, targetDepth: 8,
    }, 50);

    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
  });
});
