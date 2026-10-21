// BlastSimulator2026 — dry-run a blast on a forked grid to forecast its outcome (#1968)

import type { MarketId } from '../economy/Market.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { BlastPlan } from './BlastPlan.js';
import { executeBlast, ratingFactsFrom, type BlastRating, type VillagePosition } from './BlastExecution.js';
import { applyRatingCaps } from './BlastRatingCaps.js';
import { forkVoxelGrid } from '../world/VoxelGridFork.js';

export interface BlastForecast {
  rating: BlastRating;
  fragmentCount: number;
  projectionCount: number;
  thrownShare: number;
  furthestThrowM: number;
  clearedVoxels: number;
}

/** Runs the blast on a fork of `grid`; null when the plan is invalid or has no holes. Never mutates `grid`. */
export function dryRunBlast(
  plan: BlastPlan,
  grid: VoxelGrid,
  villages: readonly VillagePosition[],
  groundFactor: number,
  wetHoleIds: ReadonlySet<string>,
  marketId?: MarketId,
): BlastForecast | null {
  if (plan.holes.length === 0) return null; // nothing to fire: executeBlast accepts an empty plan, a forecast would be meaningless
  // No emitter and no building state: the fork's blast is silent and spares every building.
  const result = executeBlast(
    plan, forkVoxelGrid(grid), villages, groundFactor, undefined, undefined, wetHoleIds, marketId,
  );
  if (!result) return null;
  // Same caps as the real report; casualty, building and fizzle facts need state the fork lacks, so they stay 0.
  const { rating } = applyRatingCaps(result.rating, {
    deaths: 0, injuries: 0, destroyedBuildings: 0,
    wetHoleCount: 0, fizzledHoleCount: 0, chargedHoleCount: 0,
    ...ratingFactsFrom(result),
  });
  return {
    rating,
    fragmentCount: result.fragmentCount,
    projectionCount: result.projectionCount,
    thrownShare: result.fragmentCount > 0 ? result.projectionCount / result.fragmentCount : 0,
    furthestThrowM: result.maxThrowDistance,
    clearedVoxels: result.clearedVoxels,
  };
}

