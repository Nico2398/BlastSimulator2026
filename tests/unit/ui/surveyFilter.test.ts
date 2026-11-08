// @vitest-environment jsdom
// BlastSimulator2026 — survey results filter criteria and filtering (#2162).
import { describe, it, expect } from 'vitest';
import {
  surveyCriteriaFromSelection,
  surveyOreIds,
  filterSurveys,
  type SurveyCriteria,
} from '../../../src/ui/surveyFilter.js';
import { FilterBarSelection } from '../../../src/ui/filterBar.js';
import type { SurveyMethod, SurveyResult } from '../../../src/core/mining/SurveyCalc.js';

const NONE: SurveyCriteria = { ore: null, method: null };
const crit = (over: Partial<SurveyCriteria>): SurveyCriteria => ({ ...NONE, ...over });

function survey(id: number, method: SurveyMethod, estimates: SurveyResult['estimates']): SurveyResult {
  return { id, method, centerX: id, centerZ: id, completedTick: id, surveyorId: 1, estimates, confidence: 0.8 };
}

const RESULTS: SurveyResult[] = [
  survey(1, 'core_sample', { '1,1': { sparkium: 0.5 } }),
  survey(2, 'seismic', { '2,2': { rustite: 0.3, sparkium: 0.4 }, '2,3': { dirtite: 0.2 } }),
  survey(3, 'aerial', { '3,3': { rustite: 0.2 } }),
  survey(4, 'core_sample', { '4,4': { dirtite: 0.1, sparkium: 0 } }),
  survey(5, 'seismic', {}),
];

const ids = (list: readonly SurveyResult[]): number[] => list.map(r => r.id);

describe('surveyCriteriaFromSelection', () => {
  it('an untouched selection yields no criteria', () => {
    expect(surveyCriteriaFromSelection(new FilterBarSelection())).toEqual(NONE);
  });

  it('reads the ore from the main filter', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'rustite';
    expect(surveyCriteriaFromSelection(sel).ore).toBe('rustite');
  });

  it('reads the method group', () => {
    const sel = new FilterBarSelection();
    for (const method of ['core_sample', 'seismic', 'aerial'] as const) {
      sel.groups['method'] = method;
      expect(surveyCriteriaFromSelection(sel).method).toBe(method);
    }
  });

  it('a method group set back to null reads as unset', () => {
    const sel = new FilterBarSelection();
    sel.groups['method'] = null;
    expect(surveyCriteriaFromSelection(sel)).toEqual(NONE);
  });

  it('reads ore and method together', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'sparkium';
    sel.groups['method'] = 'seismic';
    expect(surveyCriteriaFromSelection(sel)).toEqual({ ore: 'sparkium', method: 'seismic' });
  });
});

describe('surveyOreIds', () => {
  it('lists every ore found with density above zero, sorted', () => {
    expect(surveyOreIds(RESULTS)).toEqual(['dirtite', 'rustite', 'sparkium']);
  });

  it('lists each ore once however many columns and results report it', () => {
    const list = [survey(1, 'seismic', { '1,1': { rustite: 0.3 }, '1,2': { rustite: 0.4 } }), survey(2, 'aerial', { '2,2': { rustite: 0.1 } })];
    expect(surveyOreIds(list)).toEqual(['rustite']);
  });

  it('skips an ore only ever estimated at zero', () => {
    expect(surveyOreIds([survey(1, 'seismic', { '1,1': { rustite: 0, dirtite: 0.2 } })])).toEqual(['dirtite']);
  });

  it('no results and barren results give no ores', () => {
    expect(surveyOreIds([])).toEqual([]);
    expect(surveyOreIds([survey(1, 'aerial', {})])).toEqual([]);
  });
});

describe('filterSurveys', () => {
  it('no criteria keeps every result in input order', () => {
    expect(ids(filterSurveys(RESULTS, NONE))).toEqual([1, 2, 3, 4, 5]);
  });

  it('an ore keeps the results estimating it above zero, in input order', () => {
    expect(ids(filterSurveys(RESULTS, crit({ ore: 'sparkium' })))).toEqual([1, 2]);
    expect(ids(filterSurveys(RESULTS, crit({ ore: 'rustite' })))).toEqual([2, 3]);
    expect(ids(filterSurveys(RESULTS, crit({ ore: 'dirtite' })))).toEqual([2, 4]);
  });

  it('an ore matches on any column of the result', () => {
    // result 2 reports dirtite only on its second column
    expect(ids(filterSurveys(RESULTS, crit({ ore: 'dirtite' })))).toContain(2);
  });

  it('a zero density does not count as finding the ore', () => {
    expect(ids(filterSurveys(RESULTS, crit({ ore: 'sparkium' })))).not.toContain(4);
  });

  it('a method keeps only that method', () => {
    expect(ids(filterSurveys(RESULTS, crit({ method: 'seismic' })))).toEqual([2, 5]);
    expect(ids(filterSurveys(RESULTS, crit({ method: 'aerial' })))).toEqual([3]);
    expect(ids(filterSurveys(RESULTS, crit({ method: 'core_sample' })))).toEqual([1, 4]);
  });

  it('ore and method combine (AND)', () => {
    expect(ids(filterSurveys(RESULTS, crit({ ore: 'sparkium', method: 'seismic' })))).toEqual([2]);
    expect(ids(filterSurveys(RESULTS, crit({ ore: 'rustite', method: 'core_sample' })))).toEqual([]);
  });

  it('an ore nobody found keeps nothing', () => {
    expect(filterSurveys(RESULTS, crit({ ore: 'unobtainium' }))).toEqual([]);
  });

  it('an empty list stays empty', () => {
    expect(filterSurveys([], crit({ ore: 'rustite', method: 'aerial' }))).toEqual([]);
  });

  it('does not mutate the input list', () => {
    const input = [...RESULTS];
    filterSurveys(input, crit({ method: 'seismic' }));
    expect(ids(input)).toEqual([1, 2, 3, 4, 5]);
  });
});
