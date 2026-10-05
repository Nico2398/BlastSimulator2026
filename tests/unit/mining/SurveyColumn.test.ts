// BlastSimulator2026 — Survey column addressing (#1355)

import { describe, it, expect } from 'vitest';
import { surveyColumnKey, findSurveyForColumn } from '../../../src/core/mining/SurveyColumn.js';
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';

function makeSurvey(id: number, completedTick: number, colKeys: string[]): SurveyResult {
  const estimates: Record<string, Record<string, number>> = {};
  for (const key of colKeys) estimates[key] = { grumpite: 0.4 };
  return {
    id, method: 'seismic', centerX: 0, centerZ: 0, completedTick,
    surveyorId: 1, estimates, confidence: 0.8,
  };
}

describe('surveyColumnKey', () => {
  it('keys an integer coordinate by itself', () => {
    expect(surveyColumnKey(12, 8)).toBe('12,8');
  });

  it('floors fractional coordinates onto the containing tile', () => {
    expect(surveyColumnKey(12.5, 8.4)).toBe('12,8');
    expect(surveyColumnKey(12.9, 8.99)).toBe('12,8');
    expect(surveyColumnKey(12.6, 8.5)).toBe('12,8');
  });

  it('floors negatives toward minus infinity', () => {
    expect(surveyColumnKey(-0.5, -0.5)).toBe('-1,-1');
    expect(surveyColumnKey(-1, -1.01)).toBe('-1,-2');
  });

  it('keys zero as 0,0', () => {
    expect(surveyColumnKey(0, 0)).toBe('0,0');
    expect(surveyColumnKey(0.99, 0.01)).toBe('0,0');
  });
});

describe('findSurveyForColumn', () => {
  it('returns the survey covering the column', () => {
    const s = makeSurvey(1, 10, ['12,8']);
    expect(findSurveyForColumn([s], 12, 8)).toBe(s);
  });

  it('floors fractional coordinates onto the containing tile', () => {
    const s = makeSurvey(1, 10, ['12,8']);
    expect(findSurveyForColumn([s], 12.9, 8.4)).toBe(s);
    expect(findSurveyForColumn([s], 12.5, 8.5)).toBe(s);
  });

  it('does not round up into the next column', () => {
    const next = makeSurvey(1, 10, ['13,9']);
    expect(findSurveyForColumn([next], 12.6, 8.6)).toBeUndefined();
  });

  it('returns undefined when no survey covers the column', () => {
    expect(findSurveyForColumn([makeSurvey(1, 10, ['12,8'])], 99, 99)).toBeUndefined();
  });

  it('returns undefined for an empty survey list', () => {
    expect(findSurveyForColumn([], 12, 8)).toBeUndefined();
  });

  it('picks the most recently completed survey regardless of order', () => {
    const older = makeSurvey(1, 10, ['12,8']);
    const newer = makeSurvey(2, 50, ['12,8']);
    expect(findSurveyForColumn([older, newer], 12, 8)).toBe(newer);
    expect(findSurveyForColumn([newer, older], 12, 8)).toBe(newer);
  });

  it('ignores surveys that cover other columns', () => {
    const here = makeSurvey(1, 10, ['12,8']);
    const elsewhere = makeSurvey(2, 99, ['3,3']);
    expect(findSurveyForColumn([elsewhere, here], 12, 8)).toBe(here);
  });

  it('finds negative-coordinate columns by floor', () => {
    const s = makeSurvey(1, 10, ['-1,-1']);
    expect(findSurveyForColumn([s], -0.5, -0.5)).toBe(s);
  });
});
