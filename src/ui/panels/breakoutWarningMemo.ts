// BlastSimulator2026 — Memoised breakout prediction for the per-frame UI (#2003)
// The prediction runs the blast's energy propagation, so the Blast step and the preflight modal
// rebuild it only when an input changed, not on every update. No progression-site or software-tier
// gate: it checks the plan against the ground, which every site has.
import type { GameState } from '../../core/state/GameState.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import { hasChargedHole, type BlastPlan } from '../../core/mining/BlastPlan.js';
import { predictBreakout, type BreakoutPrediction } from '../../core/mining/BreakoutPrediction.js';
import { wetHoleIdsFor } from '../../core/mining/WetHoles.js';
import { PlanKeyedMemo, planInputsKey } from './planKeyedMemo.js';

export class BreakoutWarningMemo {
  private readonly memo = new PlanKeyedMemo<BreakoutPrediction | null>();

  /** Prediction for `plan`; recomputed only when holes, charges, wet holes or terrain changed. */
  get(state: GameState, plan: BlastPlan, grid: VoxelGrid | null): BreakoutPrediction | null {
    if (!grid || !hasChargedHole(plan)) return null;
    const wet = wetHoleIdsFor(state);
    return this.memo.get(grid, planInputsKey(plan, wet, grid), () => predictBreakout(plan, grid, wet));
  }
}
