// BlastSimulator2026 — dry-run a blast on a forked grid to forecast its outcome (#1968)

import type { MarketId } from '../economy/Market.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { BlastPlan } from './BlastPlan.js';
import type { BlastRating, VillagePosition } from './BlastExecution.js';

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
  void plan; void grid; void villages; void groundFactor; void wetHoleIds; void marketId;
  throw new Error('not implemented');
}

/** True for ratings that count as a hazard: 'bad' or 'catastrophic'. */
export function isHazardRating(rating: BlastRating): boolean {
  void rating;
  throw new Error('not implemented');
}
