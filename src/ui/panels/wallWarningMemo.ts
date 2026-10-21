// BlastSimulator2026 — Memoised wall-stability prediction for the per-frame UI (#1943)
// The prediction runs the blast's energy propagation, so the preview step and the preflight
// modal rebuild it only when an input changed, not on every update.

import { isProgressionSite, type GameState } from '../../core/state/GameState.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import { hasChargedHole, type BlastPlan } from '../../core/mining/BlastPlan.js';
import { predictWallFaces, type PredictedFace } from '../../core/mining/WallStability.js';
import { wetHoleIdsFor } from '../../core/mining/WetHoles.js';
import { PlanKeyedMemo, planInputsKey } from './planKeyedMemo.js';

export class WallWarningMemo {
  private readonly memo = new PlanKeyedMemo<PredictedFace[]>();

  /** Predicted faces for `plan`; recomputed only when holes, charges, wet holes or terrain changed. */
  get(state: GameState, plan: BlastPlan, grid: VoxelGrid | null): PredictedFace[] {
    if (!grid || !isProgressionSite(state) || !hasChargedHole(plan)) return [];
    const wet = wetHoleIdsFor(state);
    return this.memo.get(grid, planInputsKey(plan, wet, grid), () => predictWallFaces(plan, grid, wet));
  }
}
