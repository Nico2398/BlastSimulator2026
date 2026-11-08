// BlastSimulator2026 — survey results filter criteria (#2162).

import type { SurveyMethod, SurveyResult } from '../core/mining/SurveyCalc.js';
import type { FilterBarSelection } from './filterBar.js';

export interface SurveyCriteria {
  ore: string | null;
  method: SurveyMethod | null;
}

/** Read the bar selection: filter = ore, group `method`. */
export function surveyCriteriaFromSelection(_selection: FilterBarSelection): SurveyCriteria {
  throw new Error('not implemented');
}

/** Ore ids estimated above zero in at least one result, sorted. */
export function surveyOreIds(_results: readonly SurveyResult[]): string[] {
  throw new Error('not implemented');
}

/** Results matching every criterion, input order kept. */
export function filterSurveys(_results: readonly SurveyResult[], _criteria: SurveyCriteria): SurveyResult[] {
  throw new Error('not implemented');
}
