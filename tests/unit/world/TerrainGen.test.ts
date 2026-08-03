import { describe, it, expect } from 'vitest';
import { generateTerrain, surfaceDensityAt, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { getBiome } from '../../../src/core/world/BiomeCatalog.js';
import { getDominantRockId } from '../../../src/core/world/VoxelGrid.js';

function makeConfig(seed: number, biomeId = 'desert_badlands'): TerrainConfig {
  const biome = getBiome(biomeId)!;
  return { sizeX: 32, sizeY: 32, sizeZ: 32, seed, climateBias: biome.climateCenter };
}

describe('TerrainGen — determinism', () => {
  it('same seed produces identical terrain', () => {
    const a = generateTerrain(makeConfig(42));
    const b = generateTerrain(makeConfig(42));
    for (const [x, y, z] of [[5, 5, 5], [10, 3, 15], [20, 10, 20]] as const) {
      const va = a.getVoxel(x, y, z)!;
      const vb = b.getVoxel(x, y, z)!;
      expect(va.composition.rocks.length).toBeGreaterThan(0);
      expect(va.composition.rocks[0]!.rockId).toBe(vb.composition.rocks[0]!.rockId);
      expect(va.density).toBe(vb.density);
    }
  });

  it('different seeds produce different terrain', () => {
    const a = generateTerrain(makeConfig(42));
    const b = generateTerrain(makeConfig(99));
    let differences = 0;
    for (let x = 5; x < 25; x += 5) {
      const va = a.getVoxel(x, 5, 15)!;
      const vb = b.getVoxel(x, 5, 15)!;
      const domA = getDominantRockId(va.composition);
      const domB = getDominantRockId(vb.composition);
      if (domA !== domB) differences++;
    }
    expect(differences).toBeGreaterThan(0);
  });
});

describe('TerrainGen — structure', () => {
  it('surface voxels above ground are empty (density=0)', () => {
    const grid = generateTerrain(makeConfig(42));
    let airCount = 0;
    for (let x = 0; x < 32; x++) {
      const v = grid.getVoxel(x, 31, 16)!;
      if (v.density === 0) airCount++;
    }
    expect(airCount).toBe(32);
  });

  it('ore density is zero in the neutral border zone', () => {
    const grid = generateTerrain(makeConfig(42));
    const borderWidth = 5;
    for (let y = 0; y < 5; y++) {
      const v = grid.getVoxel(0, y, 0)!;
      if (v.density > 0) {
        expect(Object.keys(v.oreDensities).length).toBe(0);
      }
    }
  });

  it('ore density distribution roughly matches rock type probabilities over large sample', () => {
    const grid = generateTerrain({
      ...makeConfig(42, 'alpine_granite'),
      sizeX: 64,
      sizeY: 64,
      sizeZ: 64,
    });
    let totalSolid = 0;
    let totalWithOre = 0;
    for (let x = 10; x < 54; x += 2) {
      for (let z = 10; z < 54; z += 2) {
        for (let y = 0; y < 30; y += 2) {
          const v = grid.getVoxel(x, y, z)!;
          if (v.density > 0) {
            totalSolid++;
            if (Object.keys(v.oreDensities).length > 0) {
              totalWithOre++;
            }
          }
        }
      }
    }
    expect(totalSolid).toBeGreaterThan(0);
    const oreRate = totalWithOre / totalSolid;
    expect(oreRate).toBeGreaterThan(0.01);
    expect(oreRate).toBeLessThan(0.8);
  });
});

describe('TerrainGen — sub-voxel surface placement (#458)', () => {
  it('surfaceDensityAt crosses 0.5 exactly at the continuous surface height', () => {
    for (const h of [10.0, 10.2, 10.5, 10.75, 7.999]) {
      expect(surfaceDensityAt(h, h)).toBeCloseTo(0.5, 10);
    }
  });

  it('is fully solid a voxel below the surface and fully air a voxel above it', () => {
    const h = 12.3;
    expect(surfaceDensityAt(h - 1, h)).toBe(1);
    expect(surfaceDensityAt(h + 1, h)).toBe(0);
  });

  it('never leaves the [0, 1] range a density is allowed to take', () => {
    for (const y of [-40, 0, 12, 400]) {
      const d = surfaceDensityAt(y, 12.3);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('lets marching cubes reproduce a fractional height, not a rounded one', () => {
    // The interpolation marching cubes actually performs: the 0.5 crossing
    // between the two corners that bracket the surface.
    const isoCrossing = (surfaceH: number): number => {
      const y0 = Math.floor(surfaceH);
      const d0 = surfaceDensityAt(y0, surfaceH);
      const d1 = surfaceDensityAt(y0 + 1, surfaceH);
      return y0 + (0.5 - d0) / (d1 - d0);
    };
    for (const h of [10.1, 10.4, 10.6, 10.9, 23.25]) {
      expect(isoCrossing(h)).toBeCloseTo(h, 6);
    }
  });

  it('a generated column carries a fractional density at its surface', () => {
    // Terraces come from every voxel being 0 or 1: with only those two values
    // marching cubes can only ever put a surface on a half-voxel.
    const grid = generateTerrain(makeConfig(42));
    let fractional = 0;
    for (let x = 4; x < 28; x++) {
      for (let z = 4; z < 28; z++) {
        for (let y = 0; y < 32; y++) {
          const d = grid.densityAt(x, y, z);
          if (d > 0.001 && d < 0.999) fractional++;
        }
      }
    }
    expect(fractional).toBeGreaterThan(0);
  });

  it('leaves the deep interior fully solid — only the surface band is fractional', () => {
    const grid = generateTerrain(makeConfig(42));
    for (let x = 8; x < 24; x += 4) {
      for (let z = 8; z < 24; z += 4) {
        expect(grid.densityAt(x, 1, z)).toBe(1);
      }
    }
  });
});
