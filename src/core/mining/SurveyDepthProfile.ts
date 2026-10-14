// BlastSimulator2026 — Depth-resolved survey results (stubs, #1683)

import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { Random } from '../math/Random.js';

/** One depth slice of a surveyed column. */
export interface SurveyDepthBand {
  /** Metres below the column surface, inclusive. */
  fromM: number;
  /** Metres below the column surface, exclusive. */
  toM: number;
  /** Noisy ore density per ore id, rounded to 0.05; zero densities omitted. */
  ores: Record<string, number>;
}

/** Build the noisy per-band ore profile of one column over the sampled Y levels. */
export function buildDepthProfile(
  grid: VoxelGrid,
  x: number,
  z: number,
  yLevels: readonly number[],
  bandMetres: number,
  finalError: number,
  rng: Random,
): SurveyDepthBand[] {
  // TODO: implement
  void grid; void x; void z; void yLevels; void bandMetres; void finalError; void rng;
  return [];
}

/** Metre span from the first to the last band holding the ore; undefined when absent. */
export function oreDepthSpan(
  bands: readonly SurveyDepthBand[] | undefined,
  oreId: string,
): { fromM: number; toM: number } | undefined {
  // TODO: implement
  void bands; void oreId;
  return undefined;
}
