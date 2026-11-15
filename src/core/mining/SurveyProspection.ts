// BlastSimulator2026 — Long-range prospection (#2286): a coarse map of the ore islands, no per-voxel detail.

import type { Random } from '../math/Random.js';
import type { OreIsland } from '../world/OreIslands.js';

/** One island as a prospection reports it: a coarse area and the G2 ore that dominates it. */
export interface ProspectedIsland {
  x: number;
  z: number;
  radius: number;
  oreId: string;
}

/** Inputs of a prospection read. */
export interface ProspectionParams {
  centerX: number;
  centerZ: number;
  skillLevel: number;
}

/**
 * Report every island whose centre lies within the prospection radius of the centre, as a coarse area with its
 * dominant ore. Noise (position jitter, a misread ore, false leads) falls to zero at the top skill and is seeded.
 */
export function prospectIslands(
  islands: readonly OreIsland[],
  params: ProspectionParams,
  rng: Random,
): ProspectedIsland[] {
  void islands; void params; void rng;
  throw new Error('not implemented');
}
