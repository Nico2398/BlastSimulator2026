// BlastSimulator2026 — Pre-blast ore value estimate
// Counterpart to BlastOreReport.ts's post-blast actuals: before a blast fires,
// the sticky footer's EST. ORE VALUE needs a number derived only from what the
// player already knows (survey estimates), never from ground-truth ore data.
// The grid supplies rock geometry only (what breaks), never ore content.

import type { BlastPlan } from './BlastPlan.js';
import type { SurveyResult } from './SurveyCalc.js';
import { freshSurveys } from './SurveyStaleness.js';
import { findSurveyForColumn, oresSurveyedAt } from './SurveyColumn.js';
import { buildPlanEnergyField } from './BlastExecution.js';
import { identifyFragmentedVoxels } from './VoxelFragmentation.js';
import { getOre } from '../world/OreCatalog.js';
import { ORE_DENSITY_KG_M3 } from '../config/balance.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';

/** Value of one cubic metre of rock at the given surveyed densities. */
function voxelValue(densities: Record<string, number>): number {
  let value = 0;
  for (const [oreId, density] of Object.entries(densities)) {
    if (!(density > 0)) continue;
    const ore = getOre(oreId);
    if (!ore) continue;
    value += density * ORE_DENSITY_KG_M3 * ore.valuePerKg; // 1 m3 voxel
  }
  return value;
}

/**
 * Estimate the total ore value (game dollars) a blast plan will yield (#1703).
 *
 * The broken volume comes from the blast's own propagation (the same energy
 * field the preview and `executeBlast` use; wet holes in `wetHoleIds` are
 * treated as the blast would). Each broken 1 m voxel is valued from the newest
 * fresh survey covering its column, read at the voxel's own depth
 * (`oresSurveyedAt`): ore a survey did not locate at that depth counts for
 * nothing, so an aerial reading values its top 2 m only. Value =
 * density x ORE_DENSITY_KG_M3 x valuePerKg x survey confidence.
 */
export function estimateBlastOreValue(
  plan: BlastPlan,
  surveyResults: readonly SurveyResult[],
  grid: VoxelGrid,
  wetHoleIds: ReadonlySet<string> = new Set(),
): number {
  const field = buildPlanEnergyField(plan, grid, wetHoleIds);
  if (!field) return 0;
  const surveys = freshSurveys(surveyResults);
  if (surveys.length === 0) return 0;
  let value = 0;
  for (const { x, y, z } of identifyFragmentedVoxels(field, grid).fragmented) {
    const survey = findSurveyForColumn(surveys, x, z);
    if (!survey) continue;
    const densities = oresSurveyedAt(survey, x, z, y);
    if (densities) value += voxelValue(densities) * survey.confidence;
  }
  return value;
}
