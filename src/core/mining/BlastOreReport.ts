// BlastSimulator2026 — Post-blast ore yield report

import type { FragmentData } from './BlastExecution.js';
import type { SurveyResult } from './SurveyCalc.js';
import { ORE_DENSITY_KG_M3 } from '../config/balance.js';

// ── Types ─────────────────────────────────────────────────────────────────────

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
 * Return the most recently completed survey from `surveys` that contains an
 * estimate entry for `colKey`, or `undefined` if none covers the column.
 */
function findBestSurveyForColumn(
  surveys: readonly SurveyResult[],
  colKey: string,
): SurveyResult | undefined {
  let best: SurveyResult | undefined;
  for (const survey of surveys) {
    if (colKey in survey.estimates) {
      if (!best || survey.completedTick > best.completedTick) best = survey;
    }
  }
  return best;
}

/**
 * Sum the estimated ore mass (kg) for a single fragment's grid column by
 * looking up the most recent matching survey entry.
 * Returns 0 when no survey covers the fragment's column.
 */
function fragmentColumnEstimateKg(
  fragment: FragmentData,
  surveys: readonly SurveyResult[],
): number {
  const colKey = `${Math.round(fragment.position.x)},${Math.round(fragment.position.z)}`;
  const survey = findBestSurveyForColumn(surveys, colKey);
  if (!survey) return 0;
  const colEstimates = survey.estimates[colKey];
  if (!colEstimates) return 0;
  return Object.values(colEstimates).reduce(
    (sum, density) => (density > 0 ? sum + fragment.volume * density * ORE_DENSITY_KG_M3 : sum),
    0,
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute ore yield report from the fragments produced by a blast.
 *
 * Ore mass per fragment: mass = fragment.volume × oreDensity × ORE_DENSITY_KG_M3
 *
 * When `surveyResults` are provided, estimated ore mass is derived from the most
 * recent survey that covers each fragment's column `"${round(x)},${round(z)}"`.
 * `yieldRatio` is actual / estimated; defaults to 1.0 when no estimate exists.
 */
export function computeBlastOreReport(
  fragments: readonly FragmentData[],
  surveyResults?: readonly SurveyResult[],
): BlastOreReport {
  const oreYields: Record<string, number> = {};
  let estimatedYieldKg = 0;

  const surveys = surveyResults ?? [];

  for (const fragment of fragments) {
    // Accumulate actual ore mass per ore type
    for (const [oreId, density] of Object.entries(fragment.oreDensities)) {
      if (density > 0) {
        oreYields[oreId] = (oreYields[oreId] ?? 0) + fragment.volume * density * ORE_DENSITY_KG_M3;
      }
    }

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
