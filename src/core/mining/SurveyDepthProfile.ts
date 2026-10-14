// BlastSimulator2026 — Depth-resolved survey results (stubs, #1683)

import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { Random } from '../math/Random.js';
import { averageSolidOreDensity, clamp, roundToEstimateStep } from './SurveyCalc.js';

/** One depth slice of a surveyed column. */
export interface SurveyDepthBand {
  /** Metres below the column surface, inclusive. */
  fromM: number;
  /** Metres below the column surface, exclusive. */
  toM: number;
  /** Noisy ore density per ore id, rounded to 0.05; zero densities omitted. */
  ores: Record<string, number>;
}

/**
 * Build the noisy per-band ore profile of one column over the sampled Y levels.
 *
 * `yLevels` descend from the column's surface anchor (voxel = 1 m), so a level's
 * depth is `yLevels[0] - y`. Bands align to multiples of `bandMetres`; the last
 * is clipped to the window. Bands without solid ore voxels are omitted.
 */
export function buildDepthProfile(
  grid: VoxelGrid,
  x: number,
  z: number,
  yLevels: readonly number[],
  bandMetres: number,
  finalError: number,
  rng: Random,
): SurveyDepthBand[] {
  const bands: SurveyDepthBand[] = [];
  if (yLevels.length === 0) return bands;
  const anchorY = yLevels[0]!;
  let start = 0;
  while (start < yLevels.length) {
    const bandIndex = Math.floor((anchorY - yLevels[start]!) / bandMetres);
    let end = start + 1;
    while (end < yLevels.length && Math.floor((anchorY - yLevels[end]!) / bandMetres) === bandIndex) end++;

    const oreIds = new Set<string>();
    for (let i = start; i < end; i++) {
      const y = yLevels[i]!;
      if (grid.densityAt(x, y, z) > 0) {
        const ores = grid.oresAt(x, y, z);
        if (ores) for (const oreId of Object.keys(ores)) oreIds.add(oreId);
      }
    }
    const ores: Record<string, number> = {};
    for (const oreId of oreIds) {
      const density = averageSolidOreDensity(grid, x, z, yLevels, oreId, start, end);
      if (density === undefined) continue;
      const rounded = roundToEstimateStep(clamp(density + rng.gaussian(0, finalError), 0, 1));
      if (rounded > 0) ores[oreId] = rounded;
    }
    if (Object.keys(ores).length > 0) {
      bands.push({
        fromM: bandIndex * bandMetres,
        toM: Math.min((bandIndex + 1) * bandMetres, anchorY - yLevels[end - 1]! + 1),
        ores,
      });
    }
    start = end;
  }
  return bands;
}

/** Metre span from the first to the last band holding the ore; undefined when absent. */
export function oreDepthSpan(
  bands: readonly SurveyDepthBand[] | undefined,
  oreId: string,
): { fromM: number; toM: number } | undefined {
  let fromM = Infinity;
  let toM = -Infinity;
  for (const band of bands ?? []) {
    if (band.ores[oreId] === undefined) continue;
    fromM = Math.min(fromM, band.fromM);
    toM = Math.max(toM, band.toM);
  }
  return toM === -Infinity ? undefined : { fromM, toM };
}

/** Depth ranges (shallowest first) of each band that reports the ore, as given, not merged. */
export function oreDepthBands(
  bands: readonly SurveyDepthBand[] | undefined,
  oreId: string,
): Array<{ fromM: number; toM: number }> {
  const out: Array<{ fromM: number; toM: number }> = [];
  for (const band of bands ?? []) {
    if (band.ores[oreId] !== undefined) out.push({ fromM: band.fromM, toM: band.toM });
  }
  return out;
}
