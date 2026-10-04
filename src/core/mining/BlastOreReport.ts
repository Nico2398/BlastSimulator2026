// BlastSimulator2026 — Post-blast ore yield report

import type { FragmentData } from './BlastExecution.js';
import type { SurveyResult } from './SurveyCalc.js';
import { findSurveyForColumn, surveyColumnKey } from './SurveyColumn.js';
import { ORE_DENSITY_KG_M3 } from '../config/balance.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** The fields of a fragment the ore report reads. */
export type OreReportFragment = Pick<FragmentData, 'origin' | 'volume' | 'oreDensities'>;

/** Actual ore yields from a blast and comparison to pre-blast survey estimate. */
export interface BlastOreReport {
  /** Actual ore yields in kg, keyed by ore ID. */
  oreYields: Record<string, number>;
  /** Total ore mass in kg across all ore types. */
  totalYieldKg: number;
  /** Survey-estimated total ore mass in kg; 0 when no survey covers the blast zone. */
  estimatedYieldKg: number;
  /** Ratio of actual to estimated yield. 1.0 when no estimate is available. */
  yieldRatio: number;
  /** True if any treranium ore was found (triggers "Legendary Vein" event). */
  hasTreranium: boolean;
  /** Absurdium fraction of total yield mass (0–1). Triggers "Absurdium Jackpot" when > 0.3. */
  absurdiumFraction: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Sum the estimated ore mass (kg) for a single fragment's grid column by
 * looking up the most recent matching survey entry at the fragment's immutable
 * `origin` (where the rock sat), never its landing `position`.
 * Returns 0 when no survey covers the fragment's column.
 */
function fragmentColumnEstimateKg(
  fragment: OreReportFragment,
  surveys: readonly SurveyResult[],
): number {
  const { x, z } = fragment.origin;
  const survey = findSurveyForColumn(surveys, x, z);
  if (!survey) return 0;
  const colEstimates = survey.estimates[surveyColumnKey(x, z)];
  if (!colEstimates) return 0;
  const colAcc: Record<string, number> = {};
  accumulateOreMass(colAcc, fragment.volume, colEstimates);
  return Object.values(colAcc).reduce((sum, v) => sum + v, 0);
}

// ── Shared helper (exported for cross-module reuse) ────────────────────────────

/**
 * Accumulate ore mass (kg) into `acc` keyed by ore type ID.
 *
 * Uses the standard formula: **mass = volume × oreDensity × ORE_DENSITY_KG_M3**
 * and skips entries where density ≤ 0.
 *
 * @param acc       Mutable accumulator record (mutated in-place).
 * @param volume    Fragment volume in m³.
 * @param oreDensities  Map of ore type ID → density fraction (0–1).
 */
export function accumulateOreMass(
  acc: Record<string, number>,
  volume: number,
  oreDensities: Record<string, number>,
): void {
  for (const [oreId, density] of Object.entries(oreDensities)) {
    if (density > 0) {
      const kg = volume * density * ORE_DENSITY_KG_M3;
      acc[oreId] = (acc[oreId] ?? 0) + kg;
    }
  }
}

/**
 * True iff any entry in `oreDensities` is > 0 — i.e. the fragment carries
 * some amount of at least one ore type. Shared "does this fragment have any
 * ore at all" primitive: HaulDispatch.ts uses it to rank ore-bearing haul
 * candidates, SuccessTracker.ts uses it to short-circuit before iterating
 * individual ore ids for uniqueOresExtracted.
 */
export function fragmentHasOre(oreDensities: Record<string, number>): boolean {
  return Object.values(oreDensities).some(density => density > 0);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute ore yield report from the fragments produced by a blast.
 *
 * Ore mass per fragment: mass = fragment.volume × oreDensity × ORE_DENSITY_KG_M3
 *
 * When `surveyResults` are provided, estimated ore mass is derived from the most
 * recent survey that covers each fragment's origin column (`surveyColumnKey`, floor-keyed).
 * `yieldRatio` is actual / estimated; defaults to 1.0 when no estimate exists.
 */
export function computeBlastOreReport(
  fragments: readonly OreReportFragment[],
  surveyResults?: readonly SurveyResult[],
): BlastOreReport {
  const oreYields: Record<string, number> = {};
  let estimatedYieldKg = 0;

  const surveys = surveyResults ?? [];

  for (const fragment of fragments) {
    // Accumulate actual ore mass per ore type
    accumulateOreMass(oreYields, fragment.volume, fragment.oreDensities);

    // Accumulate survey-estimated ore mass for this fragment's column
    if (surveys.length > 0) {
      estimatedYieldKg += fragmentColumnEstimateKg(fragment, surveys);
    }
  }

  const totalYieldKg = Object.values(oreYields).reduce((sum, v) => sum + v, 0);
  const yieldRatio = estimatedYieldKg > 0 ? totalYieldKg / estimatedYieldKg : 1.0;
  const hasTreranium = (oreYields['treranium'] ?? 0) > 0;
  const absurdiumKg = oreYields['absurdium'] ?? 0;
  const absurdiumFraction = totalYieldKg > 0 ? absurdiumKg / totalYieldKg : 0;

  return { oreYields, totalYieldKg, estimatedYieldKg, yieldRatio, hasTreranium, absurdiumFraction };
}
