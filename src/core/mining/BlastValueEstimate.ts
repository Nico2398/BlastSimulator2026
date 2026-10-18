// BlastSimulator2026 — Pre-blast ore value estimate
// Counterpart to BlastOreReport.ts's post-blast actuals: before a blast fires,
// the sticky footer's EST. ORE VALUE needs a number derived only from what the
// player already knows (survey estimates), never from ground-truth ore data.
// The grid supplies rock geometry only (what breaks), never ore content.

import { oreValuePerKg, type MarketId } from '../economy/Market.js';
import type { BlastPlan } from './BlastPlan.js';
import type { SurveyResult } from './SurveyCalc.js';
import { freshSurveys } from './SurveyStaleness.js';
import { findSurveyForColumn, oresSurveyedAt } from './SurveyColumn.js';
import { buildPlanEnergyField } from './BlastExecution.js';
import { identifyFragmentedVoxels } from './VoxelFragmentation.js';
import { getOre } from '../world/OreCatalog.js';
import { ORE_DENSITY_KG_M3 } from '../config/balance.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';

/** Market value ($) of one m³ of rock at the given ore density fraction: density × ORE_DENSITY_KG_M3 × valuePerKg. */
export function oreValuePerM3(density: number, valuePerKg: number): number {
  return density * ORE_DENSITY_KG_M3 * valuePerKg;
}

/** Estimated ore value ($ per m³) of rock at the given densities, priced in `marketId` (#1681); unknown ore ids and non-positive densities are ignored. */
export function columnOreValuePerM3(densities: Readonly<Record<string, number>>, marketId: MarketId): number {
  let value = 0;
  for (const [oreId, density] of Object.entries(densities)) {
    if (!(density > 0)) continue;
    const ore = getOre(oreId);
    if (ore) value += oreValuePerM3(density, oreValuePerKg(oreId, marketId));
  }
  return value;
}

/** Ore value of a blast plus how much of the broken volume surveys cover (#1960). */
export interface BlastOreEstimate {
  /** Estimated ore value, game dollars. */
  value: number;
  /** Share of broken voxels covered by a fresh survey, 0..1. */
  coverage: number;
  /** Voxels the blast breaks; 0 = nothing broken. */
  brokenVoxels: number;
  /** True when the plan has charges / an energy field. */
  charged: boolean;
  /** Share 0..1 of drilled holes whose column lies in a fresh survey disc; 0 with no holes. */
  holeCoverage: number;
}

/** Estimate for a blast with nothing to value: no field, no fresh survey, or nothing broken. */
export const NO_ORE_ESTIMATE: BlastOreEstimate = Object.freeze({ value: 0, coverage: 0, brokenVoxels: 0, charged: false, holeCoverage: 0 });

/**
 * Estimate the total ore value (game dollars) a blast plan will yield (#1703),
 * and how much of the broken volume a fresh survey covers (#1960).
 *
 * The broken volume comes from the blast's own propagation (the same energy
 * field the preview and `executeBlast` use; wet holes in `wetHoleIds` are
 * treated as the blast would). Each broken 1 m voxel is valued from the newest
 * fresh survey covering its column, read at the voxel's own depth
 * (`oresSurveyedAt`): ore a survey did not locate at that depth counts for
 * nothing, so an aerial reading values its top 2 m only. Value =
 * density x ORE_DENSITY_KG_M3 x oreValuePerKg(ore, marketId) x survey confidence.
 * Coverage counts a voxel as covered whenever its column has a fresh survey,
 * whatever the depth that survey reached.
 */
export function estimateBlastOre(
  plan: BlastPlan,
  surveyResults: readonly SurveyResult[],
  grid: VoxelGrid,
  wetHoleIds: ReadonlySet<string> = new Set(),
  marketId: MarketId = 'legacy',
): BlastOreEstimate {
  const field = buildPlanEnergyField(plan, grid, wetHoleIds);
  if (!field) return NO_ORE_ESTIMATE;
  const surveys = freshSurveys(surveyResults);
  if (surveys.length === 0) return NO_ORE_ESTIMATE;
  const { fragmented } = identifyFragmentedVoxels(field, grid, false);
  if (fragmented.length === 0) return NO_ORE_ESTIMATE;
  let value = 0;
  let covered = 0;
  for (const { x, y, z } of fragmented) {
    const survey = findSurveyForColumn(surveys, x, z);
    if (!survey) continue;
    covered++;
    const densities = oresSurveyedAt(survey, x, z, y);
    if (densities) value += columnOreValuePerM3(densities, marketId) * survey.confidence;
  }
  // TODO: implement brokenVoxels / charged / holeCoverage (#1967)
  return { value, coverage: covered / fragmented.length, brokenVoxels: 0, charged: false, holeCoverage: 0 };
}

/** Estimated ore value (game dollars) of a blast plan; see `estimateBlastOre` (#1703). */
export function estimateBlastOreValue(
  plan: BlastPlan,
  surveyResults: readonly SurveyResult[],
  grid: VoxelGrid,
  wetHoleIds: ReadonlySet<string> = new Set(),
  marketId: MarketId = 'legacy',
): number {
  return estimateBlastOre(plan, surveyResults, grid, wetHoleIds, marketId).value;
}
