// BlastSimulator2026 — Pre-blast ore value estimate
// Counterpart to BlastOreReport.ts's post-blast actuals: before a blast fires,
// the sticky footer's EST. ORE VALUE needs a number derived only from what the
// player already knows (survey estimates), never from ground-truth voxel data.

import type { BlastPlan } from './BlastPlan.js';
import { freshSurveys, type SurveyResult } from './SurveyCalc.js';
import { findSurveyForColumn } from './SurveyColumn.js';
import { getOre } from '../world/OreCatalog.js';
import {
  ORE_DENSITY_KG_M3,
  BLAST_ESTIMATE_BREAK_RADIUS_M,
  BLAST_ESTIMATE_BROKEN_DEPTH_FACTOR,
} from '../config/balance.js';
import type { DrillHole } from './DrillPlan.js';
import { VoxelGrid } from '../world/VoxelGrid.js';

/**
 * Distinct 1 m columns (keyed `"x,z"` by floor) whose centre lies within
 * `radiusM` of any hole, each mapped to the deepest covering hole's depth.
 * A column covered by several holes is therefore counted once.
 */
function coveredColumns(
  holes: readonly DrillHole[],
  radiusM: number,
): Map<string, number> {
  const columns = new Map<string, number>();
  const reach = Math.ceil(radiusM);
  for (const hole of holes) {
    const cx = Math.floor(hole.x);
    const cz = Math.floor(hole.z);
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const colX = cx + dx;
        const colZ = cz + dz;
        if (Math.hypot(colX + 0.5 - hole.x, colZ + 0.5 - hole.z) > radiusM) continue;
        const key = `${colX},${colZ}`;
        columns.set(key, Math.max(columns.get(key) ?? 0, hole.depth));
      }
    }
  }
  return columns;
}

/**
 * Estimate the total ore value (game dollars) a blast plan will yield, using
 * only surveyed density estimates — never the real grid.
 *
 * A hole breaks more than its own column: every column within
 * `BLAST_ESTIMATE_BREAK_RADIUS_M` of a hole is assumed to break to
 * `BLAST_ESTIMATE_BROKEN_DEPTH_FACTOR` × the deepest covering hole's depth.
 * Each such column is valued from the most recent fresh (non-stale) survey covering it:
 * `volume × density × ORE_DENSITY_KG_M3 × ore.valuePerKg × confidence`
 * (a low-confidence aerial pass counts for less than a core sample).
 * Columns with no covering survey, no ore, or an unknown ore id contribute 0.
 */
export function estimateBlastOreValue(
  plan: BlastPlan,
  surveyResults: readonly SurveyResult[],
): number {
  let value = 0;
  const surveys = freshSurveys(surveyResults);
  const columnArea = VoxelGrid.CELL_SIZE * VoxelGrid.CELL_SIZE;

  for (const [colKey, maxDepth] of coveredColumns(plan.holes, BLAST_ESTIMATE_BREAK_RADIUS_M)) {
    const [colX, colZ] = colKey.split(',');
    const survey = findSurveyForColumn(surveys, Number(colX), Number(colZ));
    const colEstimates = survey?.estimates[colKey];
    if (!survey || !colEstimates) continue;

    const columnVolume = BLAST_ESTIMATE_BROKEN_DEPTH_FACTOR * maxDepth * columnArea;
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
