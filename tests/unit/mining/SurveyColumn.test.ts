// BlastSimulator2026 — Survey column addressing (#1355)

import { describe, it, expect } from 'vitest';
import { surveyColumnKey, findSurveyForColumn, oresSurveyedAt } from '../../../src/core/mining/SurveyColumn.js';
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';
import { SURVEY_DEPTH_BELOW_SURFACE } from '../../../src/core/config/balance.js';

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

describe('oresSurveyedAt (#1703)', () => {
  const SURFACE = 60;
  function depthSurvey(extra: Partial<SurveyResult> = {}): SurveyResult {
    return {
      id: 1, method: 'seismic', centerX: 12, centerZ: 8, completedTick: 10, surveyorId: 1, confidence: 0.8,
      estimates: { '12,8': { grumpite: 0.5 } },
      depthProfile: {
        '12,8': [
          { fromM: 0, toM: 5, ores: { grumpite: 0.4 } },
          { fromM: 10, toM: 15, ores: { grumpite: 0.8, iron: 0.1 } },
        ],
      },
      surfaceYs: { '12,8': SURFACE },
      ...extra,
    };
  }

  it('reads the band at depth = surfaceY - y', () => {
    expect(oresSurveyedAt(depthSurvey(), 12, 8, SURFACE - 2)).toEqual({ grumpite: 0.4 });
    expect(oresSurveyedAt(depthSurvey(), 12, 8, SURFACE - 12)).toEqual({ grumpite: 0.8, iron: 0.1 });
  });

  it('the surface voxel itself is depth 0', () => {
    expect(oresSurveyedAt(depthSurvey(), 12, 8, SURFACE)).toEqual({ grumpite: 0.4 });
  });

  it('floors fractional column coordinates', () => {
    expect(oresSurveyedAt(depthSurvey(), 12.9, 8.9, SURFACE - 2)).toEqual({ grumpite: 0.4 });
  });

  it('returns {} for a scanned depth between bands (scanned, no ore)', () => {
    expect(oresSurveyedAt(depthSurvey(), 12, 8, SURFACE - 7)).toEqual({});
  });

  it('returns {} for a scanned depth just inside the window below the last band', () => {
    const last = SURVEY_DEPTH_BELOW_SURFACE.seismic - 1;
    expect(oresSurveyedAt(depthSurvey(), 12, 8, SURFACE - last)).toEqual({});
  });

  it('returns undefined below the survey window (not scanned)', () => {
    const w = SURVEY_DEPTH_BELOW_SURFACE.seismic;
    expect(oresSurveyedAt(depthSurvey(), 12, 8, SURFACE - w)).toBeUndefined();
    expect(oresSurveyedAt(depthSurvey(), 12, 8, SURFACE - w - 20)).toBeUndefined();
  });

  it('a core sample window reaches deeper than a seismic one', () => {
    const core = depthSurvey({ method: 'core_sample' });
    const depth = SURVEY_DEPTH_BELOW_SURFACE.seismic + 5;
    expect(depth).toBeLessThan(SURVEY_DEPTH_BELOW_SURFACE.core_sample);
    expect(oresSurveyedAt(core, 12, 8, SURFACE - depth)).toEqual({});
    expect(oresSurveyedAt(depthSurvey(), 12, 8, SURFACE - depth)).toBeUndefined();
  });

  it('returns undefined above the surface (negative depth)', () => {
    expect(oresSurveyedAt(depthSurvey(), 12, 8, SURFACE + 1)).toBeUndefined();
    expect(oresSurveyedAt(depthSurvey(), 12, 8, SURFACE + 10)).toBeUndefined();
  });

  describe('aerial', () => {
    const aerial = (): SurveyResult => ({
      id: 2, method: 'aerial', centerX: 12, centerZ: 8, completedTick: 10, surveyorId: 1, confidence: 0.5,
      estimates: { '12,8': { grumpite: 0.3 } },
      surfaceYs: { '12,8': SURFACE + 1 },
    });

    it('reports the column estimate for the top 2 m', () => {
      expect(SURVEY_DEPTH_BELOW_SURFACE.aerial).toBe(2);
      expect(oresSurveyedAt(aerial(), 12, 8, SURFACE + 1)).toEqual({ grumpite: 0.3 });
      expect(oresSurveyedAt(aerial(), 12, 8, SURFACE)).toEqual({ grumpite: 0.3 });
    });

    it('is undefined from 2 m down', () => {
      expect(oresSurveyedAt(aerial(), 12, 8, SURFACE - 1)).toBeUndefined();
      expect(oresSurveyedAt(aerial(), 12, 8, SURFACE - 15)).toBeUndefined();
    });
  });

  describe('legacy surveys', () => {
    const legacy = (): SurveyResult => ({
      id: 3, method: 'seismic', centerX: 12, centerZ: 8, completedTick: 10, surveyorId: 1, confidence: 0.8,
      estimates: { '12,8': { grumpite: 0.5 } },
    });

    it('fall back to the whole-window column estimate at any height', () => {
      expect(oresSurveyedAt(legacy(), 12, 8, 3)).toEqual({ grumpite: 0.5 });
      expect(oresSurveyedAt(legacy(), 12, 8, 500)).toEqual({ grumpite: 0.5 });
    });

    it('fall back when only depthProfile is missing', () => {
      const s = { ...legacy(), surfaceYs: { '12,8': SURFACE } };
      expect(oresSurveyedAt(s, 12, 8, SURFACE - 2)).toEqual({ grumpite: 0.5 });
    });

    it('fall back when only surfaceYs is missing', () => {
      const s = { ...depthSurvey(), surfaceYs: undefined };
      expect(oresSurveyedAt(s, 12, 8, 3)).toEqual({ grumpite: 0.5 });
    });
  });

  it('does not throw on a malformed saved profile', () => {
    const s = depthSurvey({ depthProfile: { '12,8': 'junk' as never } });
    expect(() => oresSurveyedAt(s, 12, 8, SURFACE - 2)).not.toThrow();
  });
});
