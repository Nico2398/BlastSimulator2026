import { describe, it, expect, beforeEach } from 'vitest';
import { createGridPlan, addHole, resetHoleIds, digVoxel } from '../../../src/core/mining/DrillPlan.js';
import type { DigVoxelResult } from '../../../src/core/mining/DrillPlan.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import type { VoxelData } from '../../../src/core/world/VoxelGrid.js';

beforeEach(() => resetHoleIds());

describe('DrillPlan', () => {
  it('createGridPlan creates correct number of holes', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 3, 4, 3, 8, 0.15);
    expect(holes.length).toBe(12);
  });

  it('createGridPlan positions are correct', () => {
    const holes = createGridPlan({ x: 20, z: 25 }, 3, 4, 3, 8, 0.15);
    // First row: (20,25), (23,25), (26,25), (29,25)
    expect(holes[0]!.x).toBe(20);
    expect(holes[0]!.z).toBe(25);
    expect(holes[1]!.x).toBe(23);
    expect(holes[1]!.z).toBe(25);
    // Second row starts at z=28
    expect(holes[4]!.x).toBe(20);
    expect(holes[4]!.z).toBe(28);
  });

  it('grid spacing is correctly applied', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 2, 2, 5, 10, 0.1);
    expect(holes[0]!.x).toBe(0);
    expect(holes[1]!.x).toBe(5);
    expect(holes[2]!.z).toBe(5);
  });

  it('addHole appends a hole with unique ID', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 1, 1, 3, 8, 0.15);
    const added = addHole(holes, 10, 15, 6, 0.1);
    expect(holes.length).toBe(2);
    expect(added.id).not.toBe(holes[0]!.id);
    expect(added.x).toBe(10);
    expect(added.z).toBe(15);
    expect(added.depth).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// digVoxel tests
// ---------------------------------------------------------------------------

/** A fully solid voxel fixture. */
function solidVoxel(): VoxelData {
  return { rockId: 'cruite', density: 1, oreDensities: {}, fractureModifier: 1 };
}

describe('digVoxel', () => {
  // 5 × 5 × 5 grid — large enough for all surface-Y scenarios
  let grid: VoxelGrid;

  beforeEach(() => {
    grid = new VoxelGrid(5, 5, 5);
  });

  it('returns success:true when digging a solid voxel', () => {
    grid.setVoxel(2, 3, 2, solidVoxel());

    const result: DigVoxelResult = digVoxel(grid, 2, 3, 2);

    expect(result.success).toBe(true);
  });

  it('sets the voxel density to 0 after digging', () => {
    grid.setVoxel(2, 3, 2, solidVoxel());

    digVoxel(grid, 2, 3, 2);

    expect(grid.getVoxel(2, 3, 2)!.density).toBe(0);
  });

  it('returns affectedCell matching the dug x and z', () => {
    grid.setVoxel(1, 2, 3, solidVoxel());

    const result = digVoxel(grid, 1, 2, 3);

    expect(result.affectedCell).toEqual({ x: 1, z: 3 });
  });

  it('newSurfaceY drops to the next solid voxel below when the top voxel is dug', () => {
    // Column at (2, z=2): solid at y=3 (top) and y=2 (below)
    grid.setVoxel(2, 3, 2, solidVoxel());
    grid.setVoxel(2, 2, 2, solidVoxel());

    const result = digVoxel(grid, 2, 3, 2); // dig the top

    expect(result.newSurfaceY).toBe(2);
  });

  it('newSurfaceY is -1 when the last voxel in the column is dug', () => {
    // Column at (2, z=2): only y=3 is solid — digging it leaves an empty column
    grid.setVoxel(2, 3, 2, solidVoxel());

    const result = digVoxel(grid, 2, 3, 2);

    expect(result.newSurfaceY).toBe(-1);
  });

  it('newSurfaceY is unchanged when a non-top voxel is dug', () => {
    // Column at (2, z=2): solid at y=3 (top) and y=2; digging y=2 leaves y=3 as surface
    grid.setVoxel(2, 3, 2, solidVoxel());
    grid.setVoxel(2, 2, 2, solidVoxel());

    const result = digVoxel(grid, 2, 2, 2); // dig the lower voxel

    expect(result.newSurfaceY).toBe(3);
  });

  it('returns success:false with an error when coordinates are out of bounds', () => {
    const result = digVoxel(grid, 99, 0, 0);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns success:false with an error when the target voxel is already empty', () => {
    // grid initialises every cell to empty — no setVoxel call needed
    const result = digVoxel(grid, 2, 2, 2);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
