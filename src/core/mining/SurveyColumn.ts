// BlastSimulator2026 — Survey column addressing (single source of truth for column keys)

import type { SurveyResult } from './SurveyCalc.js';

/** Key of the survey estimate column containing world position `(x, z)`. */
export function surveyColumnKey(_x: number, _z: number): string {
  // TODO: implement
  return undefined as unknown as string;
}

/**
 * Most recently completed survey with an estimate for the column containing
 * `(x, z)`, or `undefined` when none covers it.
 */
export function findSurveyForColumn(
  _surveys: readonly SurveyResult[],
  _x: number,
  _z: number,
): SurveyResult | undefined {
  // TODO: implement
  return undefined;
}
