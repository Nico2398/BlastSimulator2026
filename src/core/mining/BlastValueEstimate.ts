// BlastSimulator2026 — Pre-blast ore value estimate
// Counterpart to BlastOreReport.ts's post-blast actuals: before a blast fires,
// the sticky footer's EST. ORE VALUE needs a number derived only from what the
// player already knows (survey estimates), never from ground-truth ore data.
// The grid supplies rock geometry only (what breaks), never ore content.

import { oreValuePerKg, type MarketId } from '../economy/Market.js';
import { hasChargedHole, type BlastPlan } from './BlastPlan.js';
import type { SurveyResult } from './SurveyCalc.js';
import { freshSurveys, isColumnInSurveyDisc } from './SurveyStaleness.js';
import { findSurveyForColumn, oresSurveyedAt } from './SurveyColumn.js';
import { isVoxelSealed, predictBreakout } from './BreakoutPrediction.js';
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
  /** Estimated ore value, game dollars; broken-out ore only. */
  value: number;
  /** Estimated ore value ($) in rock that breaks but stays sealed under an intact cap (#2053). */
  sealedValue: number;
  /** Voxels that break but stay sealed under an intact cap (#2053). */
  sealedVoxels: number;
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
export const NO_ORE_ESTIMATE: BlastOreEstimate = Object.freeze({ value: 0, sealedValue: 0, sealedVoxels: 0, coverage: 0, brokenVoxels: 0, charged: false, holeCoverage: 0 });

/**
 * Estimate the total ore value (game dollars) a blast plan will yield (#1703),
 * and how much of the broken volume a fresh survey covers (#1960).
 *
 * The broken volume comes from the blast's own propagation (`predictBreakout`,
 * the same energy field the preview and `executeBlast` use; wet holes in
 * `wetHoleIds` are treated as the blast would). Value of rock that breaks but
 * stays sealed under intact rock goes to `sealedValue`, not `value` (#2053). Each broken 1 m voxel is valued from the newest
 * fresh survey covering its column, read at the voxel's own depth
 * (`oresSurveyedAt`): ore a survey did not locate at that depth counts for
 * nothing, so an aerial reading values its top 2 m only. Value =
 * density x ORE_DENSITY_KG_M3 x oreValuePerKg(ore, marketId) x survey confidence.
 * Coverage counts a voxel as covered whenever its column lies inside any fresh
 * survey's disc (barren or not), whatever the depth that survey reached; a
 * covered barren column adds $0. `brokenVoxels` is 0 when nothing breaks,
 * `charged` is false without charges/an energy field, and `holeCoverage` is the
 * share of drilled holes inside a fresh disc (also set on the early returns).
 */
export function estimateBlastOre(
  plan: BlastPlan,
  surveyResults: readonly SurveyResult[],
  grid: VoxelGrid,
  wetHoleIds: ReadonlySet<string> = new Set(),
  marketId: MarketId = 'legacy',
): BlastOreEstimate {
  const surveys = freshSurveys(surveyResults);
  const inDisc = (x: number, z: number): boolean => surveys.some(sv => isColumnInSurveyDisc(sv, x, z));
  const holeCoverage = plan.holes.length === 0
    ? 0
    : plan.holes.filter(h => inDisc(h.x, h.z)).length / plan.holes.length;
  const charged = hasChargedHole(plan);
  const prediction = charged ? predictBreakout(plan, grid, wetHoleIds) : null;
  if (!prediction) return { ...NO_ORE_ESTIMATE, holeCoverage };
  const { fragmented } = prediction;
  if (fragmented.length === 0) return { ...NO_ORE_ESTIMATE, charged, holeCoverage };
  let value = 0;
  let sealedValue = 0;
  let covered = 0;
  for (const { x, y, z } of fragmented) {
    if (inDisc(x, z)) covered++;
    const survey = findSurveyForColumn(surveys, x, z);
    if (!survey) continue;
    const densities = oresSurveyedAt(survey, x, z, y);
    if (!densities) continue;
    const voxelValue = columnOreValuePerM3(densities, marketId) * survey.confidence;
    if (isVoxelSealed(prediction, x, y, z)) sealedValue += voxelValue;
    else value += voxelValue;
  }
  return {
    value, sealedValue, sealedVoxels: prediction.sealedVoxels,
    coverage: covered / fragmented.length, brokenVoxels: fragmented.length, charged, holeCoverage,
  };
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
