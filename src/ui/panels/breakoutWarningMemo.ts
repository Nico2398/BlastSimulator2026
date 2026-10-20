// BlastSimulator2026 — Memoised breakout prediction for the per-frame UI (#2003)
import type { GameState } from '../../core/state/GameState.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import type { BlastPlan } from '../../core/mining/BlastPlan.js';
import type { BreakoutPrediction } from '../../core/mining/BreakoutPrediction.js';

export class BreakoutWarningMemo {
  /** Prediction for `plan`; recomputed only when holes, charges, wet holes or terrain changed. */
  get(state: GameState, plan: BlastPlan, grid: VoxelGrid | null): BreakoutPrediction | null {
    void state; void plan; void grid;
    // TODO: implement
    return null;
  }
}
