// BlastSimulator2026 — survey results filter criteria (#2162).

import type { SurveyMethod, SurveyResult } from '../core/mining/SurveyCalc.js';
import type { FilterBarSelection } from './filterBar.js';

export interface SurveyCriteria {
  ore: string | null;
  method: SurveyMethod | null;
}

const METHODS: readonly string[] = ['core_sample', 'seismic', 'aerial'];

/** Read the bar selection: filter = ore, group `method`. */
export function surveyCriteriaFromSelection(selection: FilterBarSelection): SurveyCriteria {
  const method = selection.groups['method'] ?? '';
  return {
    ore: selection.filter,
    method: METHODS.includes(method) ? method as SurveyMethod : null,
  };
}

function estimatesOre(result: SurveyResult, ore: string): boolean {
  return Object.values(result.estimates).some(column => (column[ore] ?? 0) > 0);
}

/** Ore ids estimated above zero in at least one result, sorted. */
export function surveyOreIds(results: readonly SurveyResult[]): string[] {
  const ids = new Set<string>();
  for (const result of results) {
    for (const column of Object.values(result.estimates)) {
      for (const [ore, density] of Object.entries(column)) if (density > 0) ids.add(ore);
    }
  }
  return [...ids].sort();
}

/** Results matching every criterion, input order kept. */
export function filterSurveys(results: readonly SurveyResult[], criteria: SurveyCriteria): SurveyResult[] {
  return results.filter(r =>
    (criteria.method === null || r.method === criteria.method)
    && (criteria.ore === null || estimatesOre(r, criteria.ore)));
}
