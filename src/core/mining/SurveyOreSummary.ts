// BlastSimulator2026 — Survey ore summary
// Per-ore digest of a survey's estimates for the Survey panel. Estimate-only:
// never reads ground-truth voxel data.

import type { SurveyResult } from './SurveyCalc.js';
import { parseColumnKey } from './SurveyColumn.js';
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

/**
 * Surveyed column count. estimateSurveyResult omits ore-free columns, so the
 * estimates alone undercount the area. The survey centre is not part of the
 * input; it is taken as the midpoint of the estimates' bounding box, and the
 * surveyed area is the disc of SURVEY_COVERAGE_RADIUS[method] around it,
 * clipped to that box (which already excludes columns cut off by the world
 * edge). A core sample (radius 0) is exactly one column. Never fewer than the
 * columns that carry estimates, so coverage stays <= 1.
 */
function surveyedColumnCount(method: SurveyResult['method'], columnKeys: readonly string[]): number {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const key of columnKeys) {
    const { x, z } = parseColumnKey(key);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const radius = SURVEY_COVERAGE_RADIUS[method];
  let count = 0;
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      if (Math.hypot(x - cx, z - cz) <= radius) count++;
    }
  }
  return Math.max(count, columnKeys.length);
}

/** Summarise a survey per ore, sorted by estimatedValue descending; unknown ore ids are skipped. */
export function summarizeSurveyOres(
  survey: Pick<SurveyResult, 'method' | 'estimates' | 'confidence'>,
): OreAreaSummary[] {
  const columnKeys = Object.keys(survey.estimates);
  if (columnKeys.length === 0) return [];
  const surveyed = surveyedColumnCount(survey.method, columnKeys);

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
    const typicalGrade = a.sum / a.columns;
    // Mirrors BlastValueEstimate: volume x density x ORE_DENSITY_KG_M3 x valuePerKg x confidence,
    // with 1 m^2 per column and the method's scan depth as the volume.
    const estimatedTonnes = (a.columns * SURVEY_DEPTH_BELOW_SURFACE[survey.method] * typicalGrade * ORE_DENSITY_KG_M3) / 1000;
    out.push({
      oreId,
      coverage: Math.min(1, a.columns / surveyed),
      typicalGrade,
      peakGrade: a.peak,
      estimatedTonnes,
      estimatedValue: estimatedTonnes * 1000 * ore.valuePerKg * survey.confidence,
    });
  }
  return out.sort((p, q) => q.estimatedValue - p.estimatedValue);
}

/** Estimated ore value ($ per m³) of one column's estimates; unknown ore ids are ignored. */
export function columnOreValuePerM3(columnEstimates: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const [oreId, density] of Object.entries(columnEstimates)) {
    const ore = getOre(oreId);
    if (ore) total += density * ORE_DENSITY_KG_M3 * ore.valuePerKg;
  }
  return total;
}
