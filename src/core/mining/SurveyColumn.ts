// BlastSimulator2026 — Survey column addressing (single source of truth for column keys)

import type { SurveyResult } from './SurveyCalc.js';

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
