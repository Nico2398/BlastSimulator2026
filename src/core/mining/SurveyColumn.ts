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
 * Most recently completed survey covering the column containing `(x, z)`
 * (an estimate, or a scanned surface for a column whose whole-window average
 * rounded to nothing), or `undefined` when none covers it.
 */
export function findSurveyForColumn(
  surveys: readonly SurveyResult[],
  x: number,
  z: number,
): SurveyResult | undefined {
  const colKey = surveyColumnKey(x, z);
  let best: SurveyResult | undefined;
  for (const survey of surveys) {
    if (colKey in survey.estimates || (survey.surfaceYs !== undefined && colKey in survey.surfaceYs)) {
      if (!best || survey.completedTick > best.completedTick) best = survey;
    }
  }
  return best;
}

/** Voxels of partial-density rock that cap a column's top solid voxel (the survey anchor). */
const SURVEY_CAP_VOXELS = 1;

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
  if (depth < -SURVEY_CAP_VOXELS || depth >= SURVEY_DEPTH_BELOW_SURFACE[survey.method]) return undefined;
  if (!survey.depthProfile) return depth < 0 ? undefined : column ?? {}; // aerial: top window carries the column estimate
  // The partial-density cap over the top solid voxel is blasted with it but was never sampled:
  // it reads as the top band, and counts as unscanned when that band holds no ore.
  if (depth < 0) return bandOresAtDepth(bands, 0);
  return bandOresAtDepth(bands, depth) ?? {};
}
