// BlastSimulator2026 — dry-run a blast on a forked grid to forecast its outcome (#1968)

import type { MarketId } from '../economy/Market.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { BlastPlan } from './BlastPlan.js';
import { executeBlast, type BlastRating, type VillagePosition } from './BlastExecution.js';
import { forkVoxelGrid } from '../world/VoxelGridFork.js';

export interface BlastForecast {
  rating: BlastRating;
  fragmentCount: number;
  projectionCount: number;
  thrownShare: number;
  furthestThrowM: number;
  clearedVoxels: number;
}

/** Runs the blast on a fork of `grid`; null when the plan is invalid. Never mutates `grid`. */
export function dryRunBlast(
  plan: BlastPlan,
  grid: VoxelGrid,
  villages: readonly VillagePosition[],
  groundFactor: number,
  wetHoleIds: ReadonlySet<string>,
  marketId?: MarketId,
): BlastForecast | null {
  // No emitter and no building state: the fork's blast is silent and spares every building.
  const result = executeBlast(
    plan, forkVoxelGrid(grid), villages, groundFactor, undefined, undefined, wetHoleIds, marketId,
  );
  if (!result) return null;
  return {
    rating: result.rating,
    fragmentCount: result.fragmentCount,
    projectionCount: result.projectionCount,
    thrownShare: result.fragmentCount > 0 ? result.projectionCount / result.fragmentCount : 0,
    furthestThrowM: result.maxThrowDistance,
    clearedVoxels: result.clearedVoxels,
  };
}

/** True for ratings that count as a hazard: 'bad' or 'catastrophic'. */
export function isHazardRating(rating: BlastRating): boolean {
  return rating === 'bad' || rating === 'catastrophic';
}
