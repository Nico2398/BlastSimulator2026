// BlastSimulator2026 — Fragment composition averaging
// A rock fragment is carved out of one or more source voxels, so its rock mix
// and ore grades are the volume-weighted average of the voxels it came from.
// Used by fragment generation (blast pipeline step 3) and by anything that
// needs to know what a piece of broken rock is actually made of.
//
// Refactor plan: docs/plans/rock-fragmentation-refactor.md §6/A3.

import type { VoxelGrid, VoxelRockComposition } from '../world/VoxelGrid.js';

/**
 * One source voxel's contribution to a fragment.
 * `weight` is the volume (m³) the fragment takes from that voxel — any
 * consistent unit works, since only the ratios between weights matter.
 */
export interface VoxelContribution {
  x: number;
  y: number;
  z: number;
  weight: number;
}

/**
 * Accumulate `key → Σ(value × weight)` across the source voxels, alongside the
 * total weight of every voxel that contributed at all.
 *
 * Dividing by the *total* weight rather than a per-key weight is what makes
 * this a real volume-weighted average: a rock present in only half the source
 * voxels must come out at half strength, not at full strength.
 */
/**
 * Weighted rock coefficients across sources. Reads through `compositionAt`
 * rather than `getVoxel`: the latter materialises a full voxel record per call,
 * and this runs for every source of every fragment of a blast.
 */
function accumulateRocks(
  sources: readonly VoxelContribution[],
  grid: VoxelGrid,
): Map<string, number> {
  const sums = new Map<string, number>();
  for (const source of sources) {
    if (!(source.weight > 0)) continue;
    const composition = grid.compositionAt(source.x, source.y, source.z);
    for (const rock of composition.rocks) {
      sums.set(rock.rockId, (sums.get(rock.rockId) ?? 0) + rock.coefficient * source.weight);
    }
  }
  return sums;
}

/** Weighted ore densities across sources, plus the weight that carried them. */
function accumulateOres(
  sources: readonly VoxelContribution[],
  grid: VoxelGrid,
): { sums: Map<string, number>; totalWeight: number } {
  const sums = new Map<string, number>();
  let totalWeight = 0;
  for (const source of sources) {
    if (!(source.weight > 0)) continue;
    totalWeight += source.weight;
    const ores = grid.oresAt(source.x, source.y, source.z);
    if (!ores) continue;
    for (const oreId in ores) {
      sums.set(oreId, (sums.get(oreId) ?? 0) + ores[oreId]! * source.weight);
    }
  }
  return { sums, totalWeight };
}

/**
 * Volume-weighted average rock composition across a fragment's source voxels.
 *
 * Coefficients are normalized to sum to 1.0 so the result is a valid
 * composition even when the source voxels' own coefficients drift (they are
 * generated from noise and normalized per voxel, but averaging and float error
 * both nudge the total).
 *
 * Entries are sorted by descending coefficient, then by id, so the dominant
 * rock is first and the ordering is deterministic.
 */
export function computeAverageRockComposition(
  sources: readonly VoxelContribution[],
  grid: VoxelGrid,
): VoxelRockComposition {
  const sums = accumulateRocks(sources, grid);
  if (sums.size === 0) return { rocks: [] };

  let total = 0;
  for (const value of sums.values()) total += value;
  if (total <= 0) return { rocks: [] };

  const rocks = [...sums.entries()]
    .map(([rockId, sum]) => ({ rockId, coefficient: sum / total }))
    .sort((a, b) => b.coefficient - a.coefficient || a.rockId.localeCompare(b.rockId));

  return { rocks };
}

/**
 * Volume-weighted average ore densities across a fragment's source voxels.
 *
 * Unlike rock coefficients these are absolute grades (0–1 of the voxel's
 * volume) and do not sum to 1, so they are averaged but never normalized —
 * normalizing would invent ore that was never in the ground.
 *
 * Zero-density entries are dropped so a fragment only carries ores it has.
 */
export function computeAverageOreDensities(
  sources: readonly VoxelContribution[],
  grid: VoxelGrid,
): Record<string, number> {
  const { sums, totalWeight } = accumulateOres(sources, grid);
  if (sums.size === 0 || totalWeight <= 0) return {};

  const result: Record<string, number> = {};
  for (const oreId of [...sums.keys()].sort()) {
    const density = sums.get(oreId)! / totalWeight;
    if (density > 0) result[oreId] = density;
  }
  return result;
}

/** The highest-coefficient rock in a composition, or '' when it is empty. */
export function dominantRockOf(composition: VoxelRockComposition): string {
  let id = '';
  let best = -Infinity;
  for (const rock of composition.rocks) {
    if (rock.coefficient > best) {
      best = rock.coefficient;
      id = rock.rockId;
    }
  }
  return id;
}
