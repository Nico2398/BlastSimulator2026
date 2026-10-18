// BlastSimulator2026 — Memoised EST. ORE VALUE for the per-frame UI (#1703)
// The estimate runs the blast's energy propagation, so the footer and preflight
// modal rebuild it only when an input changed, not on every update.

import type { GameState } from '../../core/state/GameState.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import type { BlastPlan } from '../../core/mining/BlastPlan.js';
import { estimateBlastOre, NO_ORE_ESTIMATE, type BlastOreEstimate } from '../../core/mining/BlastValueEstimate.js';
import { wetHoleIdsFor } from '../../core/mining/WetHoles.js';
import { resolveMarketId } from '../../core/campaign/Level.js';

export class OreEstimateMemo {
  private key = '';
  private grid: VoxelGrid | null = null;
  private estimate: BlastOreEstimate = NO_ORE_ESTIMATE;

  /** Estimate for `plan`; recomputed only when holes, charges, wet holes, surveys or terrain changed. */
  get(state: GameState, plan: BlastPlan, grid: VoxelGrid | null): BlastOreEstimate {
    if (!grid) return NO_ORE_ESTIMATE;
    const wet = wetHoleIdsFor(state);
    const marketId = resolveMarketId(state);
    const key = JSON.stringify([
      plan.holes, plan.charges, [...wet].sort(),
      state.surveyResults.map(s => [s.id, s.stale === true, s.completedTick]),
      marketId,
      grid.editRevision,
    ]);
    if (grid === this.grid && key === this.key) return this.estimate;
    this.grid = grid;
    this.key = key;
    this.estimate = estimateBlastOre(plan, state.surveyResults, grid, wet, marketId);
    return this.estimate;
  }
}
