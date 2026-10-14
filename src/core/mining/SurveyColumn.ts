// BlastSimulator2026 — Survey column addressing (single source of truth for column keys)

import type { SurveyResult } from './SurveyCalc.js';
import { bandOresAtDepth } from './SurveyDepthProfile.js';
import { SURVEY_DEPTH_BELOW_SURFACE } from '../config/balance.js';

/**
 * Key of the survey estimate column containing world position `(x, z)`.
 * Floors, so every reader of `SurveyResult.estimates` rounds the same way.
 */
export function surveyColumnKey(x: number, z: number): string {
  return `${Math.floor(x)},${Math.floor(z)}`;
}

/** Inverse of `surveyColumnKey`: the `{ x, z }` column coordinates of a `"x,z"` key. */
export function parseColumnKey(key: string): { x: number; z: number } {
  const [x, z] = key.split(',');
  return { x: Number(x), z: Number(z) };
}

/**
 * Most recently completed survey with an estimate for the column containing
 * `(x, z)`, or `undefined` when none covers it.
 */
export function findSurveyForColumn(
  surveys: readonly SurveyResult[],
  x: number,
  z: number,
): SurveyResult | undefined {
  const colKey = surveyColumnKey(x, z);
  let best: SurveyResult | undefined;
  for (const survey of surveys) {
    if (colKey in survey.estimates) {
      if (!best || survey.completedTick > best.completedTick) best = survey;
    }
  }
  return best;
}

/**
 * Ore densities the survey located at voxel level `y` of column `(x, z)`.
 * `undefined` when that depth was not scanned; `{}` when scanned with no ore.
 * Legacy surveys without `depthProfile`/`surfaceYs` fall back to the whole-window column estimate.
 */
export function oresSurveyedAt(
  survey: SurveyResult,
  x: number,
  z: number,
  y: number,
): Record<string, number> | undefined {
  const key = surveyColumnKey(x, z);
  const column = survey.estimates?.[key];
  const surfaceY = survey.surfaceYs?.[key];
  const bands = survey.depthProfile?.[key];
  if (!survey.depthProfile && !survey.surfaceYs) return column; // legacy save
  if (typeof surfaceY !== 'number') return column;
  const depth = surfaceY - y;
  if (depth < 0 || depth >= SURVEY_DEPTH_BELOW_SURFACE[survey.method]) return undefined;
  if (!survey.depthProfile) return column; // aerial: top window carries the column estimate
  return bandOresAtDepth(bands, depth) ?? {};
}
