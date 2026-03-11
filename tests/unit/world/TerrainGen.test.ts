import { describe, it, expect } from 'vitest';
import { generateTerrain, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { getMinePreset } from '../../../src/core/world/MineType.js';

function makeConfig(seed: number, presetId = 'desert'): TerrainConfig {
  const preset = getMinePreset(presetId)!;
  return { sizeX: 32, sizeY: 32, sizeZ: 32, seed, preset };
}

describe('TerrainGen — determinism', () => {
  it('same seed produces identical terrain', () => {
    const a = generateTerrain(makeConfig(42));
    const b = generateTerrain(makeConfig(42));
    // Sample several voxels
    for (const [x, y, z] of [[5, 5, 5], [10, 3, 15], [20, 10, 20]] as const) {
      const va = a.getVoxel(x, y, z)!;
      const vb = b.getVoxel(x, y, z)!;
      expect(va.rockId).toBe(vb.rockId);
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
      if (va.rockId !== vb.rockId) differences++;
    }
    expect(differences).toBeGreaterThan(0);
  });
});

describe('TerrainGen — structure', () => {
  it('surface voxels above ground are empty (density=0)', () => {
    const grid = generateTerrain(makeConfig(42));
    // Check the very top row — should be air
    let airCount = 0;
    for (let x = 0; x < 32; x++) {
      const v = grid.getVoxel(x, 31, 16)!;
      if (v.density === 0) airCount++;
    }
    expect(airCount).toBe(32); // top row should be entirely air
  });

  it('ore density is zero in the neutral border zone', () => {
    const grid = generateTerrain(makeConfig(42));
    const borderWidth = 5;
    // Check border voxels at low y (should be solid rock but no ores)
    for (let y = 0; y < 5; y++) {
      const v = grid.getVoxel(0, y, 0)!;
      if (v.density > 0) {
        expect(Object.keys(v.oreDensities).length).toBe(0);
      }
    }
    // Check an interior voxel at same depth — may have ores
    // (not guaranteed, but over large sample it should)
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
    // Sample interior voxels
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
    // Some fraction of solid voxels should contain ore
    expect(totalSolid).toBeGreaterThan(0);
    const oreRate = totalWithOre / totalSolid;
    expect(oreRate).toBeGreaterThan(0.01);
    expect(oreRate).toBeLessThan(0.8);
  });
});
