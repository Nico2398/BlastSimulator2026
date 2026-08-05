// BlastSimulator2026 — Pre-blast ore value estimate
// Counterpart to BlastOreReport.ts's post-blast actuals: before a blast fires,
// the sticky footer's EST. ORE VALUE needs a number derived only from what the
// player already knows (survey estimates), never from ground-truth voxel data.

import type { BlastPlan } from './BlastPlan.js';
import { findSurveyForColumn, type SurveyResult } from './SurveyCalc.js';
import { getOre } from '../world/OreCatalog.js';
import { ORE_DENSITY_KG_M3 } from '../config/balance.js';
import { VoxelGrid } from '../world/VoxelGrid.js';

/**
 * Estimate the total ore value (game dollars) a blast plan will yield, using
 * only surveyed density estimates — never the real grid.
 *
 * For each hole, the most recent survey covering its column contributes
 * `depth × CELL_SIZE² × density × ORE_DENSITY_KG_M3 × ore.valuePerKg`,
 * scaled by that survey's `confidence` (a low-confidence aerial pass counts
 * for less than a core sample over the same ground). Holes with no covering
 * survey, or whose survey found no ore in that column, contribute 0.
 */
export function estimateBlastOreValue(
  plan: BlastPlan,
  surveyResults: readonly SurveyResult[],
): number {
  let value = 0;
  const columnArea = VoxelGrid.CELL_SIZE * VoxelGrid.CELL_SIZE;

  for (const hole of plan.holes) {
    const survey = findSurveyForColumn(surveyResults, hole.x, hole.z);
    if (!survey) continue;

    const colKey = `${Math.floor(hole.x)},${Math.floor(hole.z)}`;
    const colEstimates = survey.estimates[colKey];
    if (!colEstimates) continue;

    const columnVolume = hole.depth * columnArea;
    for (const [oreId, density] of Object.entries(colEstimates)) {
      if (density <= 0) continue;
      const ore = getOre(oreId);
      if (!ore) continue;
      const massKg = columnVolume * density * ORE_DENSITY_KG_M3;
      value += massKg * ore.valuePerKg * survey.confidence;
    }
  }

  return value;
}
