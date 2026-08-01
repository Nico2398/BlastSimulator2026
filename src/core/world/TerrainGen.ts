// BlastSimulator2026 — Procedural terrain generation
// Populates a VoxelGrid from the unified world height sampler (WorldGen.ts),
// a depth-stratified rock profile (Strata.ts) and per-ore anisotropic vein
// noise (OreVeins.ts).

import { VoxelGrid } from './VoxelGrid.js';
import type { BiomeDef } from './BiomeCatalog.js';
import { selectBiomeWeights, dominantBiome } from './BiomeCatalog.js';
import { createWorldGenContext, sampleSurfaceVoxelY, type HeightShapingParams } from './WorldGen.js';
import { buildStrataProfile, buildMixedHardnessStrata, StrataSampler } from './Strata.js';
import { OreVeinSampler } from './OreVeins.js';

export interface TerrainConfig {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  seed: number;
  /**
   * Bias added to the raw climate fields so this grid's own terrain lands
   * near a specific biome's climate centre (#458 T1.2/A6) — [0, 0] samples
   * the world's natural, unbiased climate. A level authors this to land its
   * intended biome; a standalone `new_game biome:X` resolves X's own
   * climateCenter and passes that directly.
   */
  climateBias: readonly [number, number];
  /**
   * Interleaves hard/soft rock layers when true: swaps the biome's normal
   * soft-to-hard strata gradient for alternating ~5 m bands of its softest
   * and hardest dominant rock (#458 D4/T1.3/A11).
   */
  mixedRockHardness?: boolean;
}

function biomeShaping(biome: BiomeDef): HeightShapingParams {
  return { baseSpline: biome.baseSpline, reliefSpline: biome.reliefSpline, pvAmplitude: biome.pvAmplitude };
}

/**
 * Generate terrain into a new VoxelGrid.
 * Algorithm:
 *   1. Sample surface height per (x, z) from the unified world generator (WorldGen.ts, #458 T1.1),
 *      climate-blended across biomes (BiomeCatalog.ts, #458 T1.2) — the same sampler the landscape
 *      heightmap will read from once it exists (T2.1), so the two representations cannot disagree
 *      at their shared boundary.
 *   2. Fill voxels below surface from a depth-stratified rock profile (Strata.ts, #458 T1.3/A11)
 *   3. Distribute ore veins using per-ore anisotropic noise (OreVeins.ts, #458 T1.3/A12)
 *   4. Clear border zone of ores (neutral zone)
 *
 * Height blends every biome's shaping by climate weight, evaluated per
 * column — a real gradient at a climate transition, not a seam. Rock/ore
 * generation (steps 2-4) still uses ONE dominant biome for the whole grid
 * (the highest-weighted biome at the grid's own centre) rather than
 * blending per column — full per-column biome-blended strata is out of
 * scope for T1.3 (no accept criterion calls for it) and would belong to a
 * future landscape-blending task if ever needed.
 */
export function generateTerrain(config: TerrainConfig): VoxelGrid {
  const { sizeX, sizeY, sizeZ, seed, climateBias, mixedRockHardness } = config;

  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);

  const worldGen = createWorldGenContext(seed, sizeX, sizeY, sizeZ, (fields) => (x, z) => {
    const weights = selectBiomeWeights(fields.temperature(x, z), fields.humidity(x, z), climateBias, 1.0);
    return weights.map(w => ({ shaping: biomeShaping(w.biome), weight: w.weight }));
  });

  const centerBiomeWeights = selectBiomeWeights(
    worldGen.fields.temperature(sizeX / 2, sizeZ / 2),
    worldGen.fields.humidity(sizeX / 2, sizeZ / 2),
    climateBias,
    1.0,
  );
  const biome = dominantBiome(centerBiomeWeights);

  const profile = mixedRockHardness
    ? buildMixedHardnessStrata(biome.dominantRocks)
    : buildStrataProfile(biome.dominantRocks);
  const strata = new StrataSampler(seed, profile);
  const oreVeins = new OreVeinSampler(seed);

  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const surfaceY = sampleSurfaceVoxelY(worldGen, x, z);
      const boundaries = strata.boundariesAt(x, z);
      const inBorder = isInBorderZone(x, z, sizeX, sizeZ, biome.borderWidth);

      for (let y = 0; y < sizeY; y++) {
        if (y >= surfaceY) {
          // Above surface = air (default empty voxel)
          continue;
        }

        const depth = surfaceY - y;
        const composition = strata.compositionAt(x, y, z, depth, boundaries);
        const compId = grid.palette.intern(composition);
        const oreDensities = inBorder ? {} : oreVeins.densitiesAt(x, y, z, depth, composition, biome.oreRichness);

        grid.fillVoxel(x, y, z, compId, oreDensities);
      }
    }
  }

  return grid;
}

/** Check if a position is in the neutral border zone. */
function isInBorderZone(
  x: number, z: number,
  sizeX: number, sizeZ: number,
  borderWidth: number,
): boolean {
  return x < borderWidth || x >= sizeX - borderWidth
    || z < borderWidth || z >= sizeZ - borderWidth;
}
