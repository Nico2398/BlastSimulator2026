// BlastSimulator2026 — Memoised breakout prediction for the per-frame UI (#2003)
// The prediction runs the blast's energy propagation, so the Blast step and the preflight modal
// rebuild it only when an input changed, not on every update. No progression-site or software-tier
// gate: it checks the plan against the ground, which every site has.
import type { GameState } from '../../core/state/GameState.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import { hasChargedHole, type BlastPlan } from '../../core/mining/BlastPlan.js';
import { predictBreakout, type BreakoutPrediction } from '../../core/mining/BreakoutPrediction.js';
import { wetHoleIdsFor } from '../../core/mining/WetHoles.js';

export class BreakoutWarningMemo {
  private key = '';
  private grid: VoxelGrid | null = null;
  private prediction: BreakoutPrediction | null = null;

  /** Prediction for `plan`; recomputed only when holes, charges, wet holes or terrain changed. */
  get(state: GameState, plan: BlastPlan, grid: VoxelGrid | null): BreakoutPrediction | null {
    if (!grid || !hasChargedHole(plan)) return null;
    const wet = wetHoleIdsFor(state);
    const key = JSON.stringify([plan.holes, plan.charges, [...wet].sort(), grid.editRevision]);
    if (grid === this.grid && key === this.key) return this.prediction;
    this.grid = grid;
    this.key = key;
    this.prediction = predictBreakout(plan, grid, wet);
    return this.prediction;
  }
}
