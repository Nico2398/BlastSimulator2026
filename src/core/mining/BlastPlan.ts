// BlastSimulator2026 — Blast plan composition
// Combines drill plan + charge plan + sequence into a complete blast definition.

import type { DrillHole } from './DrillPlan.js';
import type { HoleCharge } from './ChargePlan.js';

export interface BlastPlan {
  holes: DrillHole[];
  charges: Record<string, HoleCharge>;
  delays: Record<string, number>;
}

export interface ValidationError {
  holeId: string;
  issue: string;
}

/** Validate that a blast plan is complete (all holes charged and sequenced). */
export function validateBlastPlan(plan: BlastPlan): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const hole of plan.holes) {
    if (!plan.charges[hole.id]) {
      errors.push({ holeId: hole.id, issue: 'Missing charge' });
    }
    if (plan.delays[hole.id] === undefined) {
      errors.push({ holeId: hole.id, issue: 'Missing sequence delay' });
    }
  }

  return errors;
}

/** Assemble a blast plan from current GameState fields. */
export function assembleBlastPlan(
  holes: DrillHole[],
  charges: Record<string, HoleCharge>,
  delays: Record<string, number>,
): BlastPlan {
  return { holes, charges, delays };
}
