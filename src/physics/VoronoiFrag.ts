// BlastSimulator2026 — Voronoi fragmentation module
// Step 3 of the blast pipeline: fragmentation score computation and seed point cloud generation.
// Task 5.8 — computeFragmentationScore + Voronoi seed sampling

import type { Random } from '../core/math/Random.js';
import type { VoxelData } from '../core/world/VoxelGrid.js';
import { FRAGMENTATION_SCORE_SCALE } from '../core/config/balance.js';
import { computeThreshold } from '../core/mining/BlastCalc.js';
import type { Vec3 } from '../core/math/Vec3.js';

// --------------------------------------------------------
// § 3.1: Fragmentation Score
// --------------------------------------------------------

/**
 * Compute F(v) = FRAGMENTATION_SCORE_SCALE * (effectiveEnergy[v] / T(v)).
 * Returns 0 for air voxels (empty composition or density ≤ 0) and when threshold ≤ 0.
 * Returns 0 for NaN or Infinity effectiveEnergy.
 */
export function computeFragmentationScore(voxel: VoxelData, effectiveEnergy: number): number {
  // Guard non-finite energy (NaN, Infinity, -Infinity)
  if (!Number.isFinite(effectiveEnergy)) return 0;
  // Air voxel — no rock
  if (voxel.composition.rocks.length === 0) return 0;
  // Zero or negative density — effectively air
  if (voxel.density <= 0) return 0;
  // No energy to fragment
  if (effectiveEnergy <= 0) return 0;
  // Compute weighted threshold
  const threshold = computeThreshold(voxel);
  if (threshold <= 0) return 0;
  return FRAGMENTATION_SCORE_SCALE * (effectiveEnergy / threshold);
}

/**
 * Number of Voronoi seeds per voxel: max(1, round(F(v))).
 * Returns 1 for NaN or Infinity score.
 */
export function fragmentCount(score: number): number {
  // Guard non-finite score (NaN, Infinity, -Infinity)
  if (!Number.isFinite(score)) return 1;
  return Math.max(1, Math.round(score));
}

// --------------------------------------------------------
// § 3.2: Seed Sampling
// --------------------------------------------------------

/**
 * Sample fragmentCount(v) random 3D points inside the voxel's unit cube [x, x+1) × [y, y+1) × [z, z+1).
 * Returns empty array when the voxel is air (score = 0) or effectiveEnergy is 0.
 */
export function voronoiSeedSamples(
  voxel: VoxelData,
  effectiveEnergy: number,
  x: number,
  y: number,
  z: number,
  rng: Random,
): Vec3[] {
  const score = computeFragmentationScore(voxel, effectiveEnergy);
  if (score <= 0) return [];
  const count = fragmentCount(score);
  const points: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: rng.nextFloat(x, x + 1),
      y: rng.nextFloat(y, y + 1),
      z: rng.nextFloat(z, z + 1),
    });
  }
  return points;
}

/**
 * Generate the full point cloud of Voronoi seeds across all fragmented voxels.
 * Returns a flat array of 3D seed points.
 * Returns empty array when fragmentedVoxels is empty.
 *
 * Missing effectiveEnergy entries are treated as 0 energy — fragmentCount(0) = 1
 * so those voxels contribute exactly 1 seed point each.
 */
export function generateSeedPointCloud(
  fragmentedVoxels: Set<string>,
  effectiveEnergy: Map<string, number>,
  grid: { getVoxel: (x: number, y: number, z: number) => VoxelData | undefined },
  rng: Random,
): Vec3[] {
  const points: Vec3[] = [];

  for (const key of fragmentedVoxels) {
    const parts = key.split(',');
    if (parts.length !== 3) continue;
    const sx = Number(parts[0]);
    const sy = Number(parts[1]);
    const sz = Number(parts[2]);
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) continue;

    const voxel = grid.getVoxel(sx, sy, sz);
    if (!voxel) continue;
    // Skip air voxels
    if (voxel.composition.rocks.length === 0 || voxel.density <= 0) continue;

    // Missing energy → treat as 0 → fragmentCount(0) = 1 seed point
    const energy = effectiveEnergy.get(key) ?? 0;
    const score = computeFragmentationScore(voxel, energy);
    const count = fragmentCount(score);

    for (let i = 0; i < count; i++) {
      points.push({
        x: rng.nextFloat(sx, sx + 1),
        y: rng.nextFloat(sy, sy + 1),
        z: rng.nextFloat(sz, sz + 1),
      });
    }
  }

  return points;
}
