// BlastSimulator2026 — Survey ore summary
// Per-ore digest of a survey's estimates for the Survey panel. Estimate-only:
// never reads ground-truth voxel data.

import type { SurveyResult } from './SurveyCalc.js';
import { isColumnInSurveyDisc } from './SurveyStaleness.js';
import { oreValuePerM3 } from './BlastValueEstimate.js';
import { getOre } from '../world/OreCatalog.js';
import { ORE_DENSITY_KG_M3, SURVEY_COVERAGE_RADIUS, SURVEY_DEPTH_BELOW_SURFACE } from '../config/balance.js';

/** What one survey says about one ore across the surveyed area. */
export interface OreAreaSummary {
  oreId: string;
  /** Share in [0, 1] of surveyed columns with estimated density > 0. */
  coverage: number;
  /** Mean estimated density over the columns that found this ore. */
  typicalGrade: number;
  /** Highest estimated column density. */
  peakGrade: number;
  /** Estimated ore mass across the surveyed area (tonnes). */
  estimatedTonnes: number;
  /** Estimated market value across the surveyed area ($). */
  estimatedValue: number;
}

/** Kilograms per tonne. */
const KG_PER_TONNE = 1000;

/**
 * Nominal surveyed column count: the columns inside the SURVEY_COVERAGE_RADIUS
 * disc around the survey centre (the same test estimateSurveyResult applies).
 * estimateSurveyResult omits ore-free columns, so the estimates alone cannot
 * give the area. World-edge clipping is not modelled (the world size is not
 * part of a SurveyResult), so a survey near the edge reads slightly low.
 * A core sample (radius 0) is exactly one column. Never fewer than the columns
 * that carry estimates, so coverage stays <= 1.
 */
function surveyedColumnCount(
  survey: Pick<SurveyResult, 'method' | 'centerX' | 'centerZ'>,
  estimatedColumns: number,
): number {
  const radius = Math.ceil(SURVEY_COVERAGE_RADIUS[survey.method]);
  const x0 = Math.floor(survey.centerX);
  const z0 = Math.floor(survey.centerZ);
  let count = 0;
  for (let x = x0 - radius; x <= x0 + radius; x++) {
    for (let z = z0 - radius; z <= z0 + radius; z++) {
      if (isColumnInSurveyDisc(survey, x, z)) count++;
    }
  }
  return Math.max(count, estimatedColumns);
}

/** Summarise a survey per ore, sorted by estimatedValue descending; unknown ore ids are skipped. */
export function summarizeSurveyOres(
  survey: Pick<SurveyResult, 'method' | 'estimates' | 'confidence' | 'centerX' | 'centerZ'>,
): OreAreaSummary[] {
  const columnKeys = Object.keys(survey.estimates);
  if (columnKeys.length === 0) return [];
  const surveyed = surveyedColumnCount(survey, columnKeys.length);

  const acc = new Map<string, { columns: number; sum: number; peak: number }>();
  for (const column of Object.values(survey.estimates)) {
    for (const [oreId, density] of Object.entries(column)) {
      if (!(density > 0)) continue;
      const a = acc.get(oreId) ?? { columns: 0, sum: 0, peak: 0 };
      a.columns++;
      a.sum += density;
      a.peak = Math.max(a.peak, density);
      acc.set(oreId, a);
    }
  }

  const out: OreAreaSummary[] = [];
  for (const [oreId, a] of acc) {
    const ore = getOre(oreId);
    if (!ore) continue;
    const typicalGrade = Math.min(a.peak, a.sum / a.columns); // clamp: float sum drift can exceed the peak
    // Mirrors BlastValueEstimate: volume x oreValuePerM3 x confidence,
    // with 1 m^2 per column and the method's scan depth as the volume.
    const volume = a.columns * SURVEY_DEPTH_BELOW_SURFACE[survey.method];
    const estimatedTonnes = (volume * typicalGrade * ORE_DENSITY_KG_M3) / KG_PER_TONNE;
    out.push({
      oreId,
      coverage: Math.min(1, a.columns / surveyed),
      typicalGrade,
      peakGrade: a.peak,
      estimatedTonnes,
      estimatedValue: volume * oreValuePerM3(typicalGrade, ore.valuePerKg) * survey.confidence,
    });
  }
  return out.sort((p, q) => q.estimatedValue - p.estimatedValue);
}
