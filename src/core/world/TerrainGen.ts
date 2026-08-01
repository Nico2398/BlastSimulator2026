// BlastSimulator2026 — Procedural terrain generation
// Populates a VoxelGrid from the unified world height sampler (WorldGen.ts)
// plus per-rock/per-ore 3D simplex noise for composition.

import { createNoise3D } from 'simplex-noise';
import { Random } from '../math/Random.js';
import { VoxelGrid, type VoxelRockComposition } from './VoxelGrid.js';
import { getAllRocks, type RockType } from './RockCatalog.js';
import type { BiomeDef } from './BiomeCatalog.js';
import { selectBiomeWeights, dominantBiome } from './BiomeCatalog.js';
import { createWorldGenContext, sampleSurfaceVoxelY, type HeightShapingParams } from './WorldGen.js';

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
   * Interleaves hard/soft rock layers when true. Threaded through for T1.3's
   * depth-stratified rock system to consume — composition generation here
   * does not yet act on it (#458 D4/T1.3).
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
 *   2. Fill voxels below surface with rock (composition from per-rock 3D noise + level bias)
 *   3. Distribute ore veins using separate 3D noise per ore type
 *   4. Clear border zone of ores (neutral zone)
 *
 * Height blends every biome's shaping by climate weight, evaluated per
 * column — a real gradient at a climate transition, not a seam. Rock/ore
 * generation (steps 2-4) is unchanged pending T1.3's strata rewrite, and
 * still uses ONE dominant biome for the whole grid (the highest-weighted
 * biome at the grid's own centre) rather than blending per column — T1.3's
 * depth-stratified system is what makes that biome-aware too.
 */
export function generateTerrain(config: TerrainConfig): VoxelGrid {
  const { sizeX, sizeY, sizeZ, seed, climateBias } = config;
  const rng = new Random(seed);

  // simplex-noise uses a PRNG function for seeding
  const prngFn = () => rng.next();
  const noise3dRock = createNoise3D(prngFn);
  const noise3dOre = createNoise3D(prngFn);

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
  const rocks = selectRocksByBiome(biome);

  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const surfaceY = sampleSurfaceVoxelY(worldGen, x, z);

      for (let y = 0; y < sizeY; y++) {
        if (y >= surfaceY) {
          // Above surface = air (default empty voxel)
          continue;
        }

        const composition = computeComposition(x, y, z, rocks, noise3dRock);
        const compId = grid.palette.intern(composition);
        const inBorder = isInBorderZone(x, z, sizeX, sizeZ, biome.borderWidth);
        const oreDensities = inBorder
          ? {}
          : computeOreDensities(x, y, z, rocks, composition, biome.oreRichness, noise3dOre);

        grid.fillVoxel(x, y, z, compId, oreDensities);
      }
    }
  }

  return grid;
}

/** Select and weight rocks based on the biome's dominant rock list. */
function selectRocksByBiome(biome: BiomeDef): RockType[] {
  const allRocks = getAllRocks();
  const selected: RockType[] = [];
  for (const id of biome.dominantRocks) {
    const rock = allRocks.find(r => r.id === id);
    if (rock) selected.push(rock);
  }
  // Fallback: if no rocks match, use all rocks
  return selected.length > 0 ? selected : [...allRocks];
}

/**
 * Compute rock composition for a voxel using per-rock 3D Simplex noise + level bias.
 * For each rock type:
 *   raw[r] = simplex3(x * noiseFreq, y * noiseFreq, z * noiseFreq) + levelBias
 *   coefficient[r] = max(0, raw[r]) / sum(max(0, raw))
 *
 * If all raw values are ≤ 0, falls back to the first rock at coefficient 1.0.
 */
export function computeComposition(
  x: number, y: number, z: number,
  rocks: readonly RockType[],
  noise3d: ReturnType<typeof createNoise3D>,
): VoxelRockComposition {
  const rawValues: number[] = [];
  const clippedValues: number[] = [];
  for (const rock of rocks) {
    const raw = noise3d(x * rock.noiseFreq, y * rock.noiseFreq, z * rock.noiseFreq) + rock.levelBias;
    rawValues.push(raw);
    clippedValues.push(Math.max(0, raw));
  }

  const sum = clippedValues.reduce((a, b) => a + b, 0);
  const composition: VoxelRockComposition = { rocks: [] };

  if (sum > 0) {
    for (let i = 0; i < rocks.length; i++) {
      const coeff = clippedValues[i]! / sum;
      if (coeff > 0.01) {
        composition.rocks.push({ rockId: rocks[i]!.id, coefficient: Math.round(coeff * 100) / 100 });
      }
    }
    const finalSum = composition.rocks.reduce((s, r) => s + r.coefficient, 0);
    if (finalSum > 0 && Math.abs(finalSum - 1.0) > 0.001) {
      for (const r of composition.rocks) {
        r.coefficient = Math.round((r.coefficient / finalSum) * 100) / 100;
      }
    }
  }

  // Fallback: all clipped values are ≤ 0 — pick the rock with the highest raw value
  if (composition.rocks.length === 0 && rocks.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < rocks.length; i++) {
      if (rawValues[i]! > rawValues[bestIdx]!) {
        bestIdx = i;
      }
    }
    composition.rocks.push({ rockId: rocks[bestIdx]!.id, coefficient: 1.0 });
  }

  return composition;
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

/**
 * Compute ore densities for a voxel based on the composition and rock catalog.
 * Each rock in the composition contributes its own ore probabilities, weighted
 * by the rock's coefficient. This ensures that even non-dominant rock types
 * contribute ores with their characteristic thresholds.
 */
function computeOreDensities(
  x: number, y: number, z: number,
  rocks: readonly RockType[],
  composition: VoxelRockComposition,
  richnessMod: number,
  noise3d: ReturnType<typeof createNoise3D>,
): Record<string, number> {
  const ores: Record<string, number> = {};

  for (const comp of composition.rocks) {
    const rock = rocks.find(r => r.id === comp.rockId);
    if (!rock) continue;

    for (const [oreId, probability] of Object.entries(rock.oreProbabilities)) {
      const oreHash = simpleHash(oreId);
      const n = noise3d(
        (x + oreHash) * 0.1,
        y * 0.12,
        (z + oreHash * 0.7) * 0.1,
      );
      const threshold = 1 - probability * 2;
      if (n > threshold) {
        const density = Math.min(1.0, (n - threshold) * richnessMod * 2);
        if (density > 0.01) {
          if (!ores[oreId] || density > ores[oreId]) {
            ores[oreId] = Math.round(density * 100) / 100;
          }
        }
      }
    }
  }

  return ores;
}

/** Simple string hash for noise offset. */
function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 1000;
}
