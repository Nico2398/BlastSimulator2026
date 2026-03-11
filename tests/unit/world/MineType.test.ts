import { describe, it, expect } from 'vitest';
import { getMinePreset, getAllMinePresets } from '../../../src/core/world/MineType.js';
import { generateTerrain } from '../../../src/core/world/TerrainGen.js';

describe('MineType presets', () => {
  it('each mine type produces terrain with its expected dominant rock', () => {
    for (const preset of getAllMinePresets()) {
      const grid = generateTerrain({
        sizeX: 32, sizeY: 32, sizeZ: 32,
        seed: 42, preset,
      });
      const rockCounts: Record<string, number> = {};
      for (let x = 8; x < 24; x += 2) {
        for (let z = 8; z < 24; z += 2) {
          for (let y = 0; y < 16; y++) {
            const v = grid.getVoxel(x, y, z)!;
            if (v.density > 0) {
              rockCounts[v.rockId] = (rockCounts[v.rockId] ?? 0) + 1;
            }
          }
        }
      }
      // The most common rock should be one of the preset's dominant rocks
      const sorted = Object.entries(rockCounts).sort((a, b) => b[1] - a[1]);
      expect(sorted.length).toBeGreaterThan(0);
      const topRock = sorted[0]![0];
      expect(preset.dominantRocks).toContain(topRock);
    }
  });

  it('desert preset produces flatter terrain than mountain', () => {
    const desert = getMinePreset('desert')!;
    const mountain = getMinePreset('mountain')!;
    expect(desert.flatness).toBeGreaterThan(mountain.flatness);
    expect(desert.elevationVariation).toBeLessThan(mountain.elevationVariation);
  });
});
