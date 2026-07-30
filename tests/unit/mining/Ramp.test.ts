import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { buildRamp, RAMP_COST_PER_METER } from '../../../src/core/mining/Ramp.js';

function fillGrid(grid: VoxelGrid) {
  for (let z = 0; z < grid.sizeZ; z++)
    for (let y = 0; y < grid.sizeY; y++)
      for (let x = 0; x < grid.sizeX; x++)
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
}

/**
 * Scan a column top-down for the highest voxel with density >= 0.5 — same rule as
 * NavGrid.computeSurfaceY, kept independent here so the assertion below tests
 * observable behaviour (does the physical terrain change?) rather than reaching
 * into Ramp.ts's own computeColumnSurfaceY helper.
 */
function localSurfaceY(grid: VoxelGrid, x: number, z: number): number {
  for (let y = grid.sizeY - 1; y >= 0; y--) {
    const voxel = grid.getVoxel(x, y, z);
    if (voxel && voxel.density >= 0.5) return y;
  }
  return -1;
}

/**
 * Realistic (non-flat-from-0) terrain: solid rock from y=0 up to a surface well
 * above the ramp's carved depth range, mirroring real game terrain (surface ~y=23)
 * rather than the thin fillGrid() helper above, which happens to hide the
 * absolute-vs-relative-depth bug because its surface sits right where the ramp
 * carves anyway.
 */
function makeElevatedGrid(sizeX: number, sizeY: number, sizeZ: number, surfaceY: number): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y <= surfaceY; y++) {
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
      }
    }
  }
  return grid;
}

describe('Ramp building', () => {
  it('buildRamp modifies voxel grid to create a sloped passage', () => {
    const grid = new VoxelGrid(20, 15, 20);
    fillGrid(grid);

    // fillGrid fills the column solid from y=0 to the grid's top, so the column's
    // actual surface (not y=0) is where carving starts (step 0 → currentDepth 0).
    const surfaceY = localSurfaceY(grid, 10, 10);

    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 10, targetDepth: 8,
    }, 50000);

    expect(result.success).toBe(true);
    expect(result.voxelsCleared).toBeGreaterThan(0);

    // Check that voxels along the ramp path are cleared, at the column's real surface.
    const startVoxel = grid.getVoxel(10, surfaceY, 10);
    expect(startVoxel?.density).toBe(0);
  });

  it('ramp connects surface level to a lower elevation', () => {
    const grid = new VoxelGrid(20, 15, 30);
    fillGrid(grid);

    // fillGrid fills the column solid from y=0 to the grid's top, so the origin
    // column's real surface (not y=0) is where carving starts (step 0 → currentDepth 0).
    const originSurfaceY = localSurfaceY(grid, 10, 5);

    const result = buildRamp(grid, {
      originX: 10, originZ: 5, direction: 'south', length: 15, targetDepth: 10,
    }, 50000);

    expect(result.success).toBe(true);

    // At the start (step 0): should be cleared at the column's real surface.
    expect(grid.getVoxel(10, originSurfaceY, 5)?.density).toBe(0);

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

  it('lowers the local surface height along the path on realistic (elevated) terrain', () => {
    // Surface at y=22 — not flat-from-0 — matching a real game map's terrain height,
    // where the buggy absolute-Y carving lands deep underground and never touches
    // the topmost solid voxel, so the column's surface never visibly drops.
    const grid = makeElevatedGrid(20, 30, 30, 22);

    const originSurfaceBefore = localSurfaceY(grid, 10, 10);
    expect(originSurfaceBefore).toBe(22);

    const length = 15;
    const targetDepth = 8;
    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length, targetDepth,
    }, 50000);

    expect(result.success).toBe(true);

    // Origin column (start of ramp, step 0) — should be measurably lower than
    // the untouched surface once the ramp is actually an open cut, not buried rock.
    const originSurfaceAfter = localSurfaceY(grid, 10, 10);
    const originDrop = originSurfaceBefore - originSurfaceAfter;
    expect(originDrop).toBeGreaterThan(0);
    expect(originDrop).toBeLessThanOrEqual(targetDepth);

    // End column (last carved step, z = originZ + length - 1) — should have
    // dropped substantially further than the origin, consistent with targetDepth.
    const endZ = 10 + length - 1;
    const endSurfaceAfter = localSurfaceY(grid, 10, endZ);
    const endDrop = originSurfaceBefore - endSurfaceAfter;
    expect(endDrop).toBeGreaterThan(originDrop);
    expect(endDrop).toBeGreaterThanOrEqual(targetDepth - 3);
    expect(endDrop).toBeLessThanOrEqual(targetDepth + 1);
  });

  it('does not affect surface height of columns far outside the ramp path', () => {
    const grid = makeElevatedGrid(20, 30, 30, 22);
    const farSurfaceBefore = localSurfaceY(grid, 2, 2);

    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 10, targetDepth: 8,
    }, 50000);

    expect(result.success).toBe(true);
    const farSurfaceAfter = localSurfaceY(grid, 2, 2);
    expect(farSurfaceAfter).toBe(farSurfaceBefore);
  });
});
