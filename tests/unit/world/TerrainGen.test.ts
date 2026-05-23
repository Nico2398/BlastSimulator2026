import { describe, it, expect } from 'vitest';
import { generateTerrain, computeComposition, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { getMinePreset } from '../../../src/core/world/MineType.js';
import { createNoise3D } from 'simplex-noise';
import { getAllRocks } from '../../../src/core/world/RockCatalog.js';
import { getDominantRockId } from '../../../src/core/world/VoxelGrid.js';

function makeConfig(seed: number, presetId = 'desert'): TerrainConfig {
  const preset = getMinePreset(presetId)!;
  return { sizeX: 32, sizeY: 32, sizeZ: 32, seed, preset };
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
      ...makeConfig(42, 'mountain'),
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

describe('computeComposition', () => {
  it('returns single rock at coefficient 1.0 when only one rock supplied', () => {
    const rocks = getAllRocks().filter(r => r.id === 'cruite');
    const noise3d = createNoise3D(() => 0.5);
    const comp = computeComposition(5, 5, 5, rocks, noise3d);
    expect(comp.rocks.length).toBe(1);
    expect(comp.rocks[0]!.rockId).toBe('cruite');
    expect(comp.rocks[0]!.coefficient).toBe(1.0);
  });

  it('coefficients sum to approximately 1.0', () => {
    const rocks = getAllRocks().slice(0, 4);
    const noise3d = createNoise3D(() => 0.5);
    const comp = computeComposition(5, 5, 5, rocks, noise3d);
    const sum = comp.rocks.reduce((s, r) => s + r.coefficient, 0);
    expect(sum).toBeCloseTo(1.0, 1);
  });
});
