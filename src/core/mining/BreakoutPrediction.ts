// BlastSimulator2026 — Predicts how much of a planned blast breaks out vs stays sealed (#2003)
import type { BlastPlan } from './BlastPlan.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';

export interface BreakoutPrediction {
  brokenVoxels: number;
  sealedVoxels: number;
  /** 0..1 share of broken rock that stays sealed under intact cap. */
  sealedShare: number;
  /** Charged holes whose charge sits too deep to break out. */
  tooDeepHoleIds: string[];
  chargedHoleCount: number;
}

/** Predicts the breakout of `plan` on `grid`; null when no hole is charged. */
export function predictBreakout(
  plan: BlastPlan,
  grid: VoxelGrid,
  wetHoleIds?: ReadonlySet<string>,
): BreakoutPrediction | null {
  void plan; void grid; void wetHoleIds;
  // TODO: implement
  return null;
}

/** 'partial' / 'none' when the sealed share warrants a warning; null when no warning. */
export function breakoutWarningKind(prediction: BreakoutPrediction): 'none' | 'partial' | null {
  void prediction;
  // TODO: implement
  return null;
}
