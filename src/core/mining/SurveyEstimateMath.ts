// BlastSimulator2026 — Shared numeric helpers of survey estimation (leaf module)

import type { VoxelGrid } from '../world/VoxelGrid.js';
import { SURVEY_ESTIMATE_STEP } from '../config/balance.js';

export function clamp(val: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, val));
}

/** Round a value to the nearest SURVEY_ESTIMATE_STEP (0.05). */
export function roundToEstimateStep(val: number): number {
  return Math.round(val / SURVEY_ESTIMATE_STEP) * SURVEY_ESTIMATE_STEP;
}

/**
 * Average a specific ore's density over the subset of `yLevels` that contain
 * solid voxels. Returns `undefined` if no solid voxels are found.
 *
 * Accepts an optional `start` / `end` range into `yLevels` to avoid slicing.
 */
export function averageSolidOreDensity(
  grid: VoxelGrid,
  x: number,
  z: number,
  yLevels: readonly number[],
  oreId: string,
  start: number = 0,
  end: number = yLevels.length,
): number | undefined {
  let sum = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    const y = yLevels[i]!;
    if (grid.densityAt(x, y, z) > 0) { sum += grid.oresAt(x, y, z)?.[oreId] ?? 0; count++; }
  }
  return count > 0 ? sum / count : undefined;
}
