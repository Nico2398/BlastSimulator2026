// BlastSimulator2026 — BlastOriginSampling unit tests
// Covers the expanding-ring search for a safe blast-effect anchor point,
// including its fallback to a direct terrain sample when every ring stays
// inside the blast crater.

import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { SOLID_VOXEL_DENSITY_THRESHOLD } from '../../../src/core/config/balance.js';
import { getBlastOriginSurfaceY, boundingBoxXZ } from '../../../src/renderer/BlastOriginSampling.js';

/** Mirrors GameRenderer's private getTerrainSurfaceY: highest solid-voxel Y
 *  in the (clamped) column, or 0 if the column is empty. */
function terrainSurfaceY(grid: VoxelGrid, x: number, z: number): number {
  const gx = Math.max(0, Math.min(grid.sizeX - 1, Math.floor(x)));
  const gz = Math.max(0, Math.min(grid.sizeZ - 1, Math.floor(z)));
  for (let y = grid.sizeY - 1; y >= 0; y--) {
    const v = grid.getVoxel(gx, y, gz);
    if (v && v.density >= SOLID_VOXEL_DENSITY_THRESHOLD) return y + 1;
  }
  return 0;
}

describe('boundingBoxXZ', () => {
  it('returns the min/max X and Z across a set of points', () => {
    const box = boundingBoxXZ([{ x: 1, z: 5 }, { x: -3, z: 2 }, { x: 4, z: -1 }]);
    expect(box).toEqual({ minX: -3, maxX: 4, minZ: -1, maxZ: 5 });
  });

  it('returns Infinity/-Infinity bounds for an empty set', () => {
    const box = boundingBoxXZ([]);
    expect(box.minX).toBe(Infinity);
    expect(box.maxX).toBe(-Infinity);
  });
});

describe('getBlastOriginSurfaceY', () => {
  it('keeps expanding the search ring past a crater wider than the initial minRadius', () => {
    // Solid ground everywhere, then a wide crater (radius 10) cleared around
    // (20, 20). A single fixed-radius ring at the default minRadius (3) lands
    // entirely inside the crater and would read back y=0 (the original bug —
    // the dust cloud/flash rendered buried underground). The fix keeps
    // widening the ring until it clears the crater edge.
    const grid = new VoxelGrid(40, 10, 40);
    const solidVoxel = {
      composition: { rocks: [{ rockId: 'sandite', coefficient: 1 }] },
      density: 1,
      oreDensities: {},
      fractureModifier: 1,
    };
    for (let x = 0; x < 40; x++) {
      for (let z = 0; z < 40; z++) {
        grid.setVoxel(x, 0, z, { ...solidVoxel });
      }
    }
    for (let x = 10; x <= 30; x++) {
      for (let z = 10; z <= 30; z++) {
        if (Math.hypot(x - 20, z - 20) <= 10) grid.clearVoxel(x, 0, z);
      }
    }

    // minRadius=3: every offset ring up to r=6 stays inside the radius-10
    // crater (all density 0) — only the wider r=9 ring's diagonal offsets
    // reach outside it and find solid ground.
    const y = getBlastOriginSurfaceY(grid, (x, z) => terrainSurfaceY(grid, x, z), 20, 20, 3);
    expect(y).toBe(1);
  });

  it('falls straight through to the direct terrain sample when every ring stays inside the crater', () => {
    // Solid ground only at the exact centre column (cx, cz); every column a
    // ring offset could land on (r = 3, 6, 9 — up to the grid's max extent)
    // is left at the grid's default density-0. A ring search alone can never
    // find this column (its offsets are always non-zero), so this only
    // produces the solid height (1) if the function actually falls back to
    // getSurfaceY(cx, cz) after the ring loop exhausts — a buggy version that
    // returns 0 straight after the loop (no fallback) would report 0 here.
    const grid = new VoxelGrid(10, 5, 10);
    grid.setVoxel(5, 0, 5, {
      composition: { rocks: [{ rockId: 'sandite', coefficient: 1 }] },
      density: 1,
      oreDensities: {},
      fractureModifier: 1,
    });

    const y = getBlastOriginSurfaceY(grid, (x, z) => terrainSurfaceY(grid, x, z), 5, 5, 3);
    expect(y).toBe(1);
  });
});
