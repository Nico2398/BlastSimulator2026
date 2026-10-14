// BlastSimulator2026 — Pre-blast ore value estimate
// Counterpart to BlastOreReport.ts's post-blast actuals: before a blast fires,
// the sticky footer's EST. ORE VALUE needs a number derived only from what the
// player already knows (survey estimates), never from ground-truth ore data.
// The grid supplies geometry only (surface, solidity), not ore content.

import type { BlastPlan } from './BlastPlan.js';
import type { SurveyResult } from './SurveyCalc.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';

/**
 * Estimate the total ore value (game dollars) a blast plan will yield from
 * fresh survey depth data (#1703). Wet holes (`wetHoleIds`) are discounted as
 * the blast would treat them.
 */
export function estimateBlastOreValue(
  plan: BlastPlan,
  surveyResults: readonly SurveyResult[],
  grid: VoxelGrid,
  wetHoleIds: ReadonlySet<string> = new Set(),
): number {
  void plan; void surveyResults; void grid; void wetHoleIds;
  return 0; // TODO: implement
}
