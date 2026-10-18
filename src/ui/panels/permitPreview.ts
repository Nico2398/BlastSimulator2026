// BlastSimulator2026 — Permit preview: view model of a plan against the mine's permit (#1925)

import type { GradeState } from '../../core/economy/MineGrade.js';

/** Display-ready comparison of a blast plan with the current permit. */
export interface PermitPreview {
  over: boolean;
  kgText: string;
  holesText: string;
  fee: number;
  feeText: string;
  strikes: number;
  strikesText: string;
  warningText: string;
}

/** Plan shape needed: hole list and per-hole charges (matches `BlastPlan`). */
export interface PermitPreviewPlan {
  holes: readonly unknown[];
  charges: Readonly<Record<string, { amountKg: number }>>;
}

/** Preview of `plan` against the permit of `grade`; null when the mine has no grade. */
export function permitPreview(
  grade: GradeState | undefined,
  plan: PermitPreviewPlan,
  tick: number,
): PermitPreview | null {
  void grade; void plan; void tick;
  return null; // TODO: implement
}

/** Warning for a drill grid whose hole count exceeds the permit; null when within it. */
export function gridHoleLimitWarning(grade: GradeState | undefined, holeCount: number): string | null {
  void grade; void holeCount;
  return null; // TODO: implement
}
