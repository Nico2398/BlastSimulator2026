// BlastSimulator2026 — Procedural terrain generation
// Uses simplex noise + seeded PRNG to populate a VoxelGrid.

import { createNoise2D, createNoise3D } from 'simplex-noise';
import { Random } from '../math/Random.js';
import { VoxelGrid, type VoxelData, type VoxelRockComposition } from './VoxelGrid.js';
import { getAllRocks, type RockType } from './RockCatalog.js';
import type { MinePreset } from './MineType.js';

export interface TerrainConfig {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  seed: number;
  preset: MinePreset;
}

/**
 * Generate terrain into a new VoxelGrid.
 * Algorithm:
 *   1. Compute surface height per (x, z) using layered 2D simplex noise
 *   2. Fill voxels below surface with rock (composition from per-rock 3D noise + level bias)
 *   3. Distribute ore veins using separate 3D noise per ore type
 *   4. Clear border zone of ores (neutral zone)
 */
export function generateTerrain(config: TerrainConfig): VoxelGrid {
  const { sizeX, sizeY, sizeZ, seed, preset } = config;
  const rng = new Random(seed);

  // simplex-noise uses a PRNG function for seeding
  const prngFn = () => rng.next();
  const noise2d = createNoise2D(prngFn);
  const noise3dRock = createNoise3D(prngFn);
  const noise3dOre = createNoise3D(prngFn);

  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  const rocks = selectRocksByPreset(preset);

  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const surfaceY = computeSurfaceHeight(x, z, sizeX, sizeZ, sizeY, preset, noise2d);

      for (let y = 0; y < sizeY; y++) {
        if (y >= surfaceY) {
          // Above surface = air (default empty voxel)
          continue;
        }

        const composition = computeComposition(x, y, z, rocks, noise3dRock);
        const inBorder = isInBorderZone(x, z, sizeX, sizeZ, preset.borderWidth);
        const oreDensities = inBorder
          ? {}
          : computeOreDensities(x, y, z, rocks, composition, preset.oreRichness, noise3dOre);

        const voxel: VoxelData = {
          composition,
          density: 1.0,
          oreDensities,
          fractureModifier: 1.0,
        };
        grid.setVoxel(x, y, z, voxel);
      }
    }
  }

  return grid;
}

function computeSurfaceHeight(
  x: number, z: number,
  sizeX: number, sizeZ: number, sizeY: number,
  preset: MinePreset,
  noise2d: ReturnType<typeof createNoise2D>,
): number {
  const nx = x / sizeX;
  const nz = z / sizeZ;

  // Layered noise: large features + detail
  const n1 = noise2d(nx * 2, nz * 2) * 0.6;
  const n2 = noise2d(nx * 5, nz * 5) * 0.3;
  const n3 = noise2d(nx * 10, nz * 10) * 0.1;
  const rawNoise = n1 + n2 + n3; // range roughly [-1, 1]

  // Flatten based on preset
  const flattened = rawNoise * (1 - preset.flatness);

  const baseY = preset.baseElevation * sizeY;
  const variation = preset.elevationVariation * sizeY;
  const height = baseY + flattened * variation;

  return Math.max(1, Math.min(sizeY - 1, Math.round(height)));
}

/** Select and weight rocks based on the preset's dominant rock list. */
function selectRocksByPreset(preset: MinePreset): RockType[] {
  const allRocks = getAllRocks();
  const selected: RockType[] = [];
  for (const id of preset.dominantRocks) {
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
