// TerrainField — ChunkFieldCache reads exactly what the direct samplers read (#1603)
//
// The cache only exists to make the remesh cheaper: a mesh marched from it
// must be bit-identical to one marched straight from `sampleCorner` and
// `densityGradientNormal`. Every check below is exact equality, on a real
// generated site with the landscape's edge sampler installed, so the halo
// columns past the site edge are covered as well as owned ground.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner, runCommand } from '../../../../src/console/createRunner.js';
import { ensureLandscape, terrainConfigOf } from '../../../../src/console/commands/world.js';
import type { VoxelGrid } from '../../../../src/core/world/VoxelGrid.js';
import { Random } from '../../../../src/core/math/Random.js';
import {
  ChunkFieldCache,
  CUBE_CORNER_OFFSETS,
  densityGradientNormal,
  sampleCorner,
  type EdgeHeightSampler,
  type LatticeBox,
} from '../../../../src/renderer/terrain/TerrainField.js';

const THRESHOLD = 0.5;

let grid: VoxelGrid;
let sampler: EdgeHeightSampler;
/** A chunk-sized box on the site's west edge, one column into the halo, spanning the surface. */
let box: LatticeBox;

beforeAll(() => {
  const engine = createRunner();
  runCommand(engine, 'new_game seed:42');
  const ctx = engine.ctx;
  grid = ctx.grid!;
  const handle = ensureLandscape(ctx, terrainConfigOf(ctx.state!)!)!;
  sampler = (x, z) => handle.sampleColumn(x, z).height;

  // Find the surface at the box's corner, then carve a pit right at the edge so
  // the box holds air, solid rock, a crater wall and halo ground at once.
  let surfaceY = 0;
  for (let y = 120; y > -40; y--) {
    if (grid.densityAt(grid.minX + 2, y, grid.minZ + 2) >= THRESHOLD) { surfaceY = y; break; }
  }
  for (let x = grid.minX; x < grid.minX + 5; x++) {
    for (let z = grid.minZ + 3; z < grid.minZ + 8; z++) {
      for (let y = surfaceY - 4; y <= surfaceY; y++) grid.clearVoxel(x, y, z);
    }
  }
  box = {
    minX: grid.minX - 1, maxX: grid.minX + 15,
    minY: surfaceY - 8, maxY: surfaceY + 8,
    minZ: grid.minZ, maxZ: grid.minZ + 15,
  };
});

function forEachCorner(b: LatticeBox, pad: number, visit: (x: number, y: number, z: number) => void): void {
  for (let z = b.minZ - pad; z <= b.maxZ + pad; z++) {
    for (let y = b.minY - pad; y <= b.maxY + pad; y++) {
      for (let x = b.minX - pad; x <= b.maxX + pad; x++) visit(x, y, z);
    }
  }
}

describe('ChunkFieldCache', () => {
  it('holds the direct density at every corner of its padded box, and past it', () => {
    const cache = new ChunkFieldCache(grid, sampler, box);
    let mismatches = 0;
    let solid = 0;
    forEachCorner(box, 2, (x, y, z) => {
      const direct = sampleCorner(grid, sampler, x, y, z).density;
      if (cache.densityAt(x, y, z) !== direct) mismatches++;
      if (direct >= THRESHOLD) solid++;
    });
    expect(mismatches).toBe(0);
    // The fixture really straddles the surface: neither all air nor all rock.
    expect(solid).toBeGreaterThan(0);
    expect(solid).toBeLessThan((box.maxX - box.minX + 5) * (box.maxY - box.minY + 5) * (box.maxZ - box.minZ + 5));
  });

  it('returns sampleCorner\'s own rock and ore at every corner, halo columns included', () => {
    const cache = new ChunkFieldCache(grid, sampler, box);
    forEachCorner(box, 2, (x, y, z) => {
      expect(cache.corner(x, y, z)).toEqual(sampleCorner(grid, sampler, x, y, z));
    });
    // Asked twice, the same sample — the second read is the cached one.
    expect(cache.corner(box.minX, box.minY, box.minZ)).toBe(cache.corner(box.minX, box.minY, box.minZ));
  });

  it('computes each cube case from the same densities as the corners', () => {
    const cache = new ChunkFieldCache(grid, sampler, box);
    let crossing = 0;
    // Includes cubes whose far corner leaves the padded box (the fallback path).
    for (let z = box.minZ - 1; z <= box.maxZ + 1; z++) {
      for (let y = box.minY - 1; y <= box.maxY + 1; y++) {
        for (let x = box.minX - 1; x <= box.maxX + 1; x++) {
          let expected = 0;
          CUBE_CORNER_OFFSETS.forEach(([dx, dy, dz], i) => {
            if (sampleCorner(grid, sampler, x + dx, y + dy, z + dz).density >= THRESHOLD) expected |= 1 << i;
          });
          expect(cache.cubeIndex(x, y, z, THRESHOLD)).toBe(expected);
          if (expected !== 0 && expected !== 255) crossing++;
        }
      }
    }
    expect(crossing).toBeGreaterThan(0);
  });

  it('gives densityGradientNormal\'s exact normal anywhere in and around the box', () => {
    const cache = new ChunkFieldCache(grid, sampler, box);
    const rng = new Random(1603);
    for (let i = 0; i < 2000; i++) {
      // Up to two voxels outside the box, so the blend's fallback is exercised too.
      const x = rng.nextFloat(box.minX - 2, box.maxX + 2);
      const y = rng.nextFloat(box.minY - 2, box.maxY + 2);
      const z = rng.nextFloat(box.minZ - 2, box.maxZ + 2);
      expect(cache.normal(x, y, z)).toEqual(densityGradientNormal(grid, sampler, x, y, z));
    }
    // Lattice-aligned points, where a blend weight is exactly zero.
    forEachCorner(box, 0, (x, y, z) => {
      expect(cache.normal(x, y, z)).toEqual(densityGradientNormal(grid, sampler, x, y, z));
    });
  });

  it('matches the direct samplers with no edge sampler installed', () => {
    const cache = new ChunkFieldCache(grid, null, box);
    forEachCorner(box, 1, (x, y, z) => {
      expect(cache.corner(x, y, z)).toEqual(sampleCorner(grid, null, x, y, z));
    });
    expect(cache.normal(box.minX + 0.3, box.minY + 7.6, box.minZ + 4.1))
      .toEqual(densityGradientNormal(grid, null, box.minX + 0.3, box.minY + 7.6, box.minZ + 4.1));
  });
});
