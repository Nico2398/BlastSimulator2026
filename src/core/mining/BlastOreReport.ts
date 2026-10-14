// BlastSimulator2026 — Post-blast ore yield report

import type { FragmentData } from './BlastExecution.js';
import type { SurveyResult } from './SurveyCalc.js';
import { freshSurveys } from './SurveyStaleness.js';
import { findSurveyForColumn, oresSurveyedAt } from './SurveyColumn.js';
import { ORE_DENSITY_KG_M3 } from '../config/balance.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** The fields of a fragment the ore report reads. */
type OreReportFragment = Pick<FragmentData, 'origin' | 'volume' | 'oreDensities'>;

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
 * Estimated ore mass (kg) for a fragment from the survey reading at its
 * immutable `origin` (where the rock sat, never its landing `position`), at the
 * origin's depth. `undefined` when no survey scanned that depth.
 */
function fragmentEstimateKg(
  fragment: OreReportFragment,
  surveys: readonly SurveyResult[],
): number | undefined {
  const { x, y, z } = fragment.origin;
  const survey = findSurveyForColumn(surveys, x, z);
  if (!survey) return undefined;
  const densities = oresSurveyedAt(survey, x, z, Math.floor(y));
  if (!densities) return undefined;
  const acc: Record<string, number> = {};
  accumulateOreMass(acc, fragment.volume, densities);
  return Object.values(acc).reduce((sum, v) => sum + v, 0);
}

// ── Shared helper (exported for cross-module reuse) ────────────────────────────

/**
 * Ore mass (kg) one ore contributes to a fragment of `volume` m³ at the given
 * density fraction (0–1): volume × density × ORE_DENSITY_KG_M3.
 */
export function oreContributionKg(volume: number, density: number): number {
  return volume * density * ORE_DENSITY_KG_M3;
}

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
      const kg = oreContributionKg(volume, density);
      acc[oreId] = (acc[oreId] ?? 0) + kg;
    }
  }
}

/**
 * Subtract from `collectedOre` the exact ore-kg every ore carries in a
 * fragment slice of `volume` m³. Returns the per-ore breakdown removed.
 */
export function decrementCollectedOre(
  collectedOre: Record<string, number>,
  slice: { volume: number; oreDensities: Record<string, number> },
): Record<string, number> {
  const acc: Record<string, number> = {};
  accumulateOreMass(acc, slice.volume, slice.oreDensities);
  for (const [oreId, kg] of Object.entries(acc)) {
    collectedOre[oreId] = (collectedOre[oreId] ?? 0) - kg;
  }
  return acc;
}

/** Floor every `collectedOre` entry at 0, absorbing float drift left by repeated decrements. */
export function clampCollectedOre(collectedOre: Record<string, number>): void {
  for (const oreId of Object.keys(collectedOre)) {
    if (collectedOre[oreId]! < 0) collectedOre[oreId] = 0;
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
 * Each fragment is read at its origin depth (`oresSurveyedAt`); fragments at an unscanned
 * depth add no estimate and their actual ore is left out of the `yieldRatio` numerator.
 * `yieldRatio` is actual / estimated; defaults to 1.0 when no fragment was scanned.
 * `totalYieldKg` and `oreYields` stay all-inclusive.
 */
export function computeBlastOreReport(
  fragments: readonly OreReportFragment[],
  surveyResults?: readonly SurveyResult[],
): BlastOreReport {
  const oreYields: Record<string, number> = {};
  let estimatedYieldKg = 0;

  const surveys = freshSurveys(surveyResults ?? []);

  let scannedActualKg = 0;
  let anyScanned = false;

  for (const fragment of fragments) {
    accumulateOreMass(oreYields, fragment.volume, fragment.oreDensities);
    if (surveys.length === 0) continue;
    const estimateKg = fragmentEstimateKg(fragment, surveys);
    if (estimateKg === undefined) continue; // unscanned depth: out of the comparison
    anyScanned = true;
    estimatedYieldKg += estimateKg;
    const actual: Record<string, number> = {};
    accumulateOreMass(actual, fragment.volume, fragment.oreDensities);
    scannedActualKg += Object.values(actual).reduce((sum, v) => sum + v, 0);
  }

  const totalYieldKg = Object.values(oreYields).reduce((sum, v) => sum + v, 0);
  const yieldRatio = anyScanned && estimatedYieldKg > 0 ? scannedActualKg / estimatedYieldKg : 1.0;
  const hasTreranium = (oreYields['treranium'] ?? 0) > 0;
  const absurdiumKg = oreYields['absurdium'] ?? 0;
  const absurdiumFraction = totalYieldKg > 0 ? absurdiumKg / totalYieldKg : 0;

  return { oreYields, totalYieldKg, estimatedYieldKg, yieldRatio, hasTreranium, absurdiumFraction };
}
