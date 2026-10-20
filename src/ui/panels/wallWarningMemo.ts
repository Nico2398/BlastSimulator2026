// BlastSimulator2026 — Memoised wall-stability prediction for the per-frame UI (#1943)

import type { GameState } from '../../core/state/GameState.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import type { BlastPlan } from '../../core/mining/BlastPlan.js';
import type { PredictedFace } from '../../core/mining/WallStability.js';

export class WallWarningMemo {
  /** Predicted faces for `plan`; recomputed only when holes, charges, wet holes or terrain changed. */
  get(_state: GameState, _plan: BlastPlan, _grid: VoxelGrid | null): PredictedFace[] {
    return []; // TODO: implement
  }
}
