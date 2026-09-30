// Voxel memory at the scale of a real campaign level (`treranium_depths`,
// 160×160, the biggest). A generated grid is a cache of generator output plus
// the edit record (#1183): nothing is filled up front, reads that only need a
// density or an air check never build a slab, and the slabs that are built are
// capped at MAX_RESIDENT_VOXEL_SLABS — past that the least recently used are
// evicted and rebuilt on demand. Eviction itself, and exact rebuilds after it,
// are unit-tested with a fast synthetic source in VoxelGrid.test.ts; this file
// proves the same budget holds on real terrain.
//
// Keep this file's runtime bounded: exactly two generateTerrain calls and
// coarse column sampling (a 160×160 generation is not free).

import { describe, it, expect } from 'vitest';
import { VoxelGrid, computeVoxelColumnSurfaceY } from '../../../src/core/world/VoxelGrid.js';
import { generateTerrain, buildTerrainContext, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import { MAX_RESIDENT_VOXEL_SLABS } from '../../../src/core/config/balance.js';

const treraniumDepths = getLevel('treranium_depths');
if (!treraniumDepths) {
  throw new Error("VoxelGridMemory.test.ts: campaign level 'treranium_depths' not found — has it been renamed?");
}

// Two datums for the same site: the level's own, and one 105 rows higher.
// Where a site sits vertically must not change what it costs to hold.
const BASE_DATUM = treraniumDepths.datum;
const RAISED_DATUM = BASE_DATUM + 105;

function treraniumConfig(datum: number): TerrainConfig {
  return {
    sizeX: treraniumDepths!.gridX,
    datum,
    sizeZ: treraniumDepths!.gridZ,
    seed: treraniumDepths!.terrainSeed,
    climateBias: treraniumDepths!.climateBias,
    mixedRockHardness: treraniumDepths!.mixedRockHardness,
  };
}

/** Every CHUNK_SIZE/2-spaced column — coarse enough to stay fast, fine enough to reach all ~100 chunks. */
function forSampledColumns(grid: VoxelGrid, fn: (x: number, z: number) => void): void {
  const step = VoxelGrid.CHUNK_SIZE / 2;
  for (let z = grid.minZ; z < grid.maxZ; z += step) {
    for (let x = grid.minX; x < grid.maxX; x += step) fn(x, z);
  }
}

describe('VoxelGrid memory at treranium_depths scale', () => {
  const gridBase = generateTerrain(treraniumConfig(BASE_DATUM));
  const gridRaised = generateTerrain(treraniumConfig(RAISED_DATUM));

  // Must run before any other test here reads a voxel: a read may build slabs.
  it('allocatedSlabCount is 0 immediately after generateTerrain — nothing is generated up front', () => {
    expect(gridBase.allocatedSlabCount).toBe(0);
    expect(gridRaised.allocatedSlabCount).toBe(0);
  });

  it('surface queries and density reads around every sampled surface build no slab', () => {
    forSampledColumns(gridBase, (x, z) => {
      const y = computeVoxelColumnSurfaceY(gridBase, x, z)!;
      for (let d = -3; d <= 3; d++) gridBase.densityAt(x, y + d, z);
    });
    expect(gridBase.allocatedSlabCount).toBe(0);
  });

  it('composition, ore and voxel reads in open air above the surface build no slab', () => {
    forSampledColumns(gridBase, (x, z) => {
      const y = computeVoxelColumnSurfaceY(gridBase, x, z)!;
      gridBase.compositionAt(x, y + 40, z);
      gridBase.oresAt(x, y + 40, z);
      gridBase.dominantRockAt(x, y + 40, z);
      gridBase.getVoxel(x, y + 40, z);
      gridBase.clearVoxel(x, y + 40, z);
    });
    expect(gridBase.allocatedSlabCount).toBe(0);
  });

  it('reading real rock at every sampled surface builds at most two slabs per chunk, well inside the resident cap', () => {
    for (const grid of [gridBase, gridRaised]) {
      forSampledColumns(grid, (x, z) => {
        const y = computeVoxelColumnSurfaceY(grid, x, z)!;
        grid.compositionAt(x, y, z);
      });
      expect(grid.allocatedSlabCount).toBeGreaterThan(0);
      expect(grid.allocatedSlabCount).toBeLessThanOrEqual(grid.chunkCount * 2);
      expect(grid.allocatedSlabCount).toBeLessThanOrEqual(MAX_RESIDENT_VOXEL_SLABS);
    }
  });

  it('raising the site 105 rows costs the same number of slabs — memory follows what is read, not where the site sits', () => {
    expect(Math.abs(gridRaised.allocatedSlabCount - gridBase.allocatedSlabCount)).toBeLessThanOrEqual(gridBase.chunkCount / 4);
  });

  it('a shaft dug 200 rows below y = 0 stays inside the resident cap and reads back exactly', () => {
    const x0 = 100;
    const z0 = 100;
    for (let z = z0; z < z0 + 8; z++) {
      for (let x = x0; x < x0 + 8; x++) {
        const top = computeVoxelColumnSurfaceY(gridBase, x, z)!;
        for (let y = top; y >= -200; y--) gridBase.clearVoxel(x, y, z);
      }
    }
    expect(gridBase.allocatedSlabCount).toBeLessThanOrEqual(MAX_RESIDENT_VOXEL_SLABS);
    for (let z = z0; z < z0 + 8; z++) {
      for (let x = x0; x < x0 + 8; x++) {
        expect(computeVoxelColumnSurfaceY(gridBase, x, z), `shaft floor at (${x},${z})`).toBe(-201);
        expect(gridBase.densityAt(x, -120, z)).toBe(0);
      }
    }
  });

  it('both datums generate the same terrain shape, offset by exactly the datum delta — sampled at a handful of interior columns', () => {
    const ctxBase = buildTerrainContext(treraniumConfig(BASE_DATUM));
    const ctxRaised = buildTerrainContext(treraniumConfig(RAISED_DATUM));
    const expectedShift = ctxRaised.worldGen.groundOffset - ctxBase.worldGen.groundOffset;
    expect(expectedShift).toBe(RAISED_DATUM - BASE_DATUM);

    const samples: Array<[number, number]> = [[10, 10], [79, 79], [150, 150], [10, 150], [150, 10], [40, 120]];
    for (const [x, z] of samples) {
      const surfaceBase = computeVoxelColumnSurfaceY(gridBase, x, z);
      const surfaceRaised = computeVoxelColumnSurfaceY(gridRaised, x, z);
      expect(surfaceBase).not.toBeNull();
      expect(surfaceRaised).not.toBeNull();
      expect(surfaceRaised! - surfaceBase!, `surface shift at (${x},${z})`).toBe(expectedShift);
      expect(gridRaised.densityAt(x, surfaceRaised!, z), `density at the shifted surface (${x},${z})`)
        .toBeCloseTo(gridBase.densityAt(x, surfaceBase!, z), 10);
    }
  });
});
