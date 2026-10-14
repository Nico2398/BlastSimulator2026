// BlastSimulator2026 — Survey ore summary
// Per-ore digest of a survey's estimates for the Survey panel. Estimate-only:
// never reads ground-truth voxel data.

import type { SurveyResult } from './SurveyCalc.js';

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

/** Summarise a survey per ore, sorted by estimatedValue descending; unknown ore ids are skipped. */
export function summarizeSurveyOres(
  _survey: Pick<SurveyResult, 'method' | 'estimates' | 'confidence'>,
): OreAreaSummary[] {
  // TODO: implement
  return [];
}

/** Estimated ore value ($ per m³) of one column's estimates; unknown ore ids are ignored. */
export function columnOreValuePerM3(_columnEstimates: Readonly<Record<string, number>>): number {
  // TODO: implement
  return 0;
}
