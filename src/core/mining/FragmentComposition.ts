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
function accumulateWeighted(
  sources: readonly VoxelContribution[],
  grid: VoxelGrid,
  extract: (voxel: { composition: VoxelRockComposition; oreDensities: Record<string, number> }) => Array<{ key: string; value: number }>,
): { sums: Map<string, number>; totalWeight: number } {
  const sums = new Map<string, number>();
  let totalWeight = 0;

  for (const source of sources) {
    if (!(source.weight > 0)) continue;
    const voxel = grid.getVoxel(source.x, source.y, source.z);
    if (!voxel) continue;

    totalWeight += source.weight;
    for (const { key, value } of extract(voxel)) {
      sums.set(key, (sums.get(key) ?? 0) + value * source.weight);
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
  const { sums } = accumulateWeighted(sources, grid, v => v.composition.rocks.map(r => ({ key: r.rockId, value: r.coefficient })));
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
  const { sums, totalWeight } = accumulateWeighted(sources, grid, v => Object.entries(v.oreDensities).map(([oreId, density]) => ({ key: oreId, value: density })));
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
