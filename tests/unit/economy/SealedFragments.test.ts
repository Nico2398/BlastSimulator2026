// BlastSimulator2026 — Tests for SealedFragments.ts (#1774)
//
// A fragment is sealed when it sits below its column's top solid voxel:
// rock buried in a void under an intact cap, unreachable by any crew.

import { describe, it, expect } from 'vitest';
import { VoxelGrid, computeVoxelColumnSurfaceY } from '../../../src/core/world/VoxelGrid.js';
import { isFragmentSealed } from '../../../src/core/economy/SealedFragments.js';

const FILL = 10;

function makeGrid(sizeX = 6, sizeZ = 6, fillUpToY = FILL): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeZ);
  for (let y = 0; y < fillUpToY; y++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });
      }
    }
  }
  return grid;
}

describe('isFragmentSealed', () => {
  it('is true for a fragment well below the column surface', () => {
    const grid = makeGrid();
    expect(isFragmentSealed(grid, { x: 2.5, y: 3, z: 2.5 })).toBe(true);
  });

  it('is true just below the column surface (boundary)', () => {
    const grid = makeGrid();
    const top = computeVoxelColumnSurfaceY(grid, 2, 2)!;
    expect(isFragmentSealed(grid, { x: 2.5, y: top - 0.01, z: 2.5 })).toBe(true);
  });

  it('is false at the column surface height (boundary)', () => {
    const grid = makeGrid();
    const top = computeVoxelColumnSurfaceY(grid, 2, 2)!;
    expect(isFragmentSealed(grid, { x: 2.5, y: top, z: 2.5 })).toBe(false);
  });

  it('is false resting on top of the surface (top + 1)', () => {
    const grid = makeGrid();
    const top = computeVoxelColumnSurfaceY(grid, 2, 2)!;
    expect(isFragmentSealed(grid, { x: 2.5, y: top + 1, z: 2.5 })).toBe(false);
  });

  it('is false high above the surface', () => {
    const grid = makeGrid();
    expect(isFragmentSealed(grid, { x: 2.5, y: 40, z: 2.5 })).toBe(false);
  });

  it('is false when the fragment lies in a column with no ground', () => {
    const grid = new VoxelGrid(0, 0);
    expect(isFragmentSealed(grid, { x: 2.5, y: 3, z: 2.5 })).toBe(false);
  });

  it('uses the floored x/z column, so a neighbouring opened column does not unseal it', () => {
    const grid = makeGrid();
    for (let y = 3; y < FILL; y++) grid.clearVoxel(3, y, 2);
    expect(isFragmentSealed(grid, { x: 3.5, y: 5, z: 2.5 })).toBe(false);
    expect(isFragmentSealed(grid, { x: 2.5, y: 5, z: 2.5 })).toBe(true);
  });

  it('turns false once the cap above the fragment is cleared', () => {
    const grid = makeGrid();
    const position = { x: 2.5, y: 5, z: 2.5 };
    expect(isFragmentSealed(grid, position)).toBe(true);
    for (let y = 4; y < FILL; y++) grid.clearVoxel(2, y, 2);
    expect(isFragmentSealed(grid, position)).toBe(false);
  });
});
