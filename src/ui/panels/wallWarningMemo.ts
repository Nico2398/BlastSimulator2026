// BlastSimulator2026 — Memoised wall-stability prediction for the per-frame UI (#1943)
// The prediction runs the blast's energy propagation, so the preview step and the preflight
// modal rebuild it only when an input changed, not on every update.

import { isProgressionSite, type GameState } from '../../core/state/GameState.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import { hasChargedHole, type BlastPlan } from '../../core/mining/BlastPlan.js';
import { predictWallFaces, type PredictedFace } from '../../core/mining/WallStability.js';
import { wetHoleIdsFor } from '../../core/mining/WetHoles.js';

export class WallWarningMemo {
  private key = '';
  private grid: VoxelGrid | null = null;
  private faces: PredictedFace[] = [];

  /** Predicted faces for `plan`; recomputed only when holes, charges, wet holes or terrain changed. */
  get(state: GameState, plan: BlastPlan, grid: VoxelGrid | null): PredictedFace[] {
    if (!grid || !isProgressionSite(state) || !hasChargedHole(plan)) return [];
    const wet = wetHoleIdsFor(state);
    const key = JSON.stringify([plan.holes, plan.charges, [...wet].sort(), grid.editRevision]);
    if (grid === this.grid && key === this.key) return this.faces;
    this.grid = grid;
    this.key = key;
    this.faces = predictWallFaces(plan, grid, wet);
    return this.faces;
  }
}
