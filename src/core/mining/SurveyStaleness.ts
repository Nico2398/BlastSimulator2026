// BlastSimulator2026 — Survey staleness: a blast that clears a column inside a survey's disc
// invalidates that survey. Kept apart from SurveyCalc so blast-side readers
// (BlastOreReport, BlastValueEstimate) need not import the survey estimator.

import type { SurveyResult } from './SurveyCalc.js';
import { parseColumnKey } from './SurveyColumn.js';
import { SURVEY_COVERAGE_RADIUS } from '../config/balance.js';

/** True once a blast has cleared a column inside the survey's disc. */
export function isSurveyStale(result: Pick<SurveyResult, 'stale'>): boolean {
  return result.stale === true;
}

/** True when column (x, z) lies inside the survey's disc (inclusive boundary). */
export function isColumnInSurveyDisc(
  survey: Pick<SurveyResult, 'method' | 'centerX' | 'centerZ'>,
  x: number,
  z: number,
): boolean {
  const dx = x - survey.centerX;
  const dz = z - survey.centerZ;
  return Math.sqrt(dx * dx + dz * dz) <= SURVEY_COVERAGE_RADIUS[survey.method];
}

/** Surveys not yet marked stale. */
export function freshSurveys(surveys: readonly SurveyResult[]): SurveyResult[] {
  return surveys.filter(s => !isSurveyStale(s));
}

/**
 * Marks every survey whose disc contains a cleared column as stale.
 * `clearedColumns` are `"x,z"` keys. Returns the number of surveys newly marked.
 */
export function markSurveysStaleByBlast(
  surveys: SurveyResult[],
  clearedColumns: readonly string[],
): number {
  if (clearedColumns.length === 0) return 0;
  const columns = clearedColumns.map(parseColumnKey);
  let marked = 0;
  for (const survey of surveys) {
    if (isSurveyStale(survey)) continue;
    if (columns.some(c => isColumnInSurveyDisc(survey, c.x, c.z))) {
      survey.stale = true;
      marked++;
    }
  }
  return marked;
}
