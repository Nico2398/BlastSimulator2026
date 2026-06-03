// BlastSimulator2026 — Fragmentation score computation and Voronoi seed sampling
// Part of Chapter 5 (Blast Full Pipeline)
// Task 5.8: computeFragmentationScore and Voronoi seed sampling

import type { Vec3 } from '../core/math/Vec3.js';
import { vec3 } from '../core/math/Vec3.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import { Random } from '../core/math/Random.js';
import { computeThreshold, parseKey } from '../core/mining/BlastCalc.js';
import { FRAGMENTATION_SCORE_SCALE, MAX_FRAGMENTS_PER_VOXEL } from '../core/config/balance.js';

/**
 * Compute the fragmentation score for a single voxel given its effective energy
 * and fracture threshold.
 *
 * Formula: FRAGMENTATION_SCORE_SCALE * (effectiveEnergy / threshold)
 *
 * @param effectiveEnergy - The energy deposited into the voxel (after propagation).
 * @param threshold - The fracture energy threshold of the voxel (from computeThreshold).
 * @returns The fragmentation score (≥ 0). Higher = more fragments.
 */
export function computeFragmentationScore(
  effectiveEnergy: number,
  threshold: number,
): number {
  if (threshold <= 0) return 0;
  if (effectiveEnergy <= 0) return 0;
  if (!Number.isFinite(effectiveEnergy) || !Number.isFinite(threshold)) return 0;
  return FRAGMENTATION_SCORE_SCALE * (effectiveEnergy / threshold);
}

/**
 * Convert a fragmentation score into an integer fragment count for a single voxel.
 *
 * Formula: Math.max(1, Math.round(score))
 *
 * @param score - The fragmentation score (from computeFragmentationScore).
 * @returns The number of fragments this voxel produces (at least 1).
 */
export function computeFragmentCount(score: number): number {
  if (score <= 0) return 1;
  if (!Number.isFinite(score)) return 1;
  return Math.min(MAX_FRAGMENTS_PER_VOXEL, Math.max(1, Math.round(score)));
}

/**
 * Sample Voronoi seed points from a set of fragmented voxels.
 *
 * For each fragmented voxel, computes the fragmentation score from its effective energy,
 * derives a fragment count, then samples that many random points within the voxel's
 * unit cube [x, x+1) × [y, y+1) × [z, z+1).
 *
 * @param fragmentedVoxels - Set of "x,y,z" keys identifying fragmented voxels.
 * @param effectiveEnergy - Map of "x,y,z" key → deposited energy for each voxel.
 * @param grid - The voxel grid (used for threshold computation and bounds).
 * @param rng - Seeded random number generator for deterministic sampling.
 * @returns Array of Vec3 seed points (fragment centroids) for Voronoi tessellation.
 */
export function sampleVoronoiSeeds(
  fragmentedVoxels: Set<string>,
  effectiveEnergy: Map<string, number>,
  grid: VoxelGrid,
  rng: Random,
): Vec3[] {
  const points: Vec3[] = [];

  for (const key of fragmentedVoxels) {
    const coords = parseKey(key);
    if (!coords) continue;
    const [x, y, z] = coords;

    if (!grid.isInBounds(x, y, z)) continue;

    const voxel = grid.getVoxel(x, y, z);
    if (!voxel) continue;

    const energy = effectiveEnergy.get(key) ?? 0;
    const threshold = computeThreshold(voxel);
    const score = computeFragmentationScore(energy, threshold);
    const count = computeFragmentCount(score);

    for (let i = 0; i < count; i++) {
      const px = rng.nextFloat(x, x + 1);
      const py = rng.nextFloat(y, y + 1);
      const pz = rng.nextFloat(z, z + 1);
      points.push(vec3(px, py, pz));
    }
  }

  return points;
}
