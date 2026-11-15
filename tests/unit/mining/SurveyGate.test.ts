// BlastSimulator2026 — Grade-gated survey methods and the depth each reads (#2279)

import { describe, it, expect, beforeAll } from 'vitest';
import {
  surveyMethodGate,
  surveyMethodRefusal,
  surveyMethodLockLabel,
  surveyDepthM,
} from '../../../src/core/mining/SurveyGate.js';
import { SURVEY_METHODS, type SurveyMethod } from '../../../src/core/mining/SurveyCalc.js';
import { SURVEY_DEPTH_BELOW_SURFACE } from '../../../src/core/config/balance.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

describe('SurveyGate (#2279)', () => {
  beforeAll(() => setLocale('en'));

  describe('surveyMethodGate', () => {
    it('locks core_sample at grade 0 and names grade 1 as the opener', () => {
      expect(surveyMethodGate(0, 'core_sample')).toEqual({ needed: 1 });
    });

    it('leaves aerial and seismic open at grade 0', () => {
      expect(surveyMethodGate(0, 'aerial')).toBeNull();
      expect(surveyMethodGate(0, 'seismic')).toBeNull();
    });

    it.each([1, 2, 3, 5])('opens every method at grade %i', (grade) => {
      for (const method of SURVEY_METHODS) expect(surveyMethodGate(grade, method)).toBeNull();
    });

    it('opens every method on a site with no grade (non-progression)', () => {
      for (const method of SURVEY_METHODS) expect(surveyMethodGate(undefined, method)).toBeNull();
    });
  });

  describe('surveyMethodRefusal', () => {
    it('is null for every open method', () => {
      expect(surveyMethodRefusal(0, 'aerial')).toBeNull();
      expect(surveyMethodRefusal(0, 'seismic')).toBeNull();
      expect(surveyMethodRefusal(1, 'core_sample')).toBeNull();
      expect(surveyMethodRefusal(undefined, 'core_sample')).toBeNull();
    });

    it('names the opening grade by its permit name for a locked method', () => {
      const text = surveyMethodRefusal(0, 'core_sample');
      expect(text).not.toBeNull();
      expect(text).toContain('Depth');
    });

    it('is non-empty text, not a locale key', () => {
      const text = surveyMethodRefusal(0, 'core_sample')!;
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toBe('survey.method_locked');
    });
  });

  describe('surveyMethodLockLabel', () => {
    it('states the grade that opens the method', () => {
      const label = surveyMethodLockLabel(1);
      expect(label).toContain('opens at G1');
      expect(label).toContain('Depth');
    });

    it('follows the needed grade', () => {
      expect(surveyMethodLockLabel(2)).toContain('opens at G2');
      expect(surveyMethodLockLabel(2)).not.toContain('G1');
    });
  });

  describe('surveyDepthM', () => {
    it('aerial always reads 2 m', () => {
      for (const grade of [undefined, 0, 1, 2, 3]) expect(surveyDepthM('aerial', grade)).toBe(2);
    });

    it('seismic reads the 5 m surface band plus one seismic group of 3 at grade 0', () => {
      expect(surveyDepthM('seismic', 0)).toBe(8);
    });

    it.each([1, 2, 3])('seismic reads 25 m from grade %i', (grade) => {
      expect(surveyDepthM('seismic', grade)).toBe(25);
    });

    it.each([1, 2, 3])('core_sample reads 40 m from grade %i', (grade) => {
      expect(surveyDepthM('core_sample', grade)).toBe(40);
    });

    it('reads full depth with no grade', () => {
      for (const method of SURVEY_METHODS) {
        expect(surveyDepthM(method, undefined)).toBe(SURVEY_DEPTH_BELOW_SURFACE[method as SurveyMethod]);
      }
      expect(surveyDepthM('seismic', undefined)).toBe(25);
      expect(surveyDepthM('core_sample', undefined)).toBe(40);
    });

    it('never reads deeper at a lower grade', () => {
      for (const method of SURVEY_METHODS) {
        expect(surveyDepthM(method, 0)).toBeLessThanOrEqual(surveyDepthM(method, 1));
        expect(surveyDepthM(method, 1)).toBeLessThanOrEqual(surveyDepthM(method, undefined));
      }
    });
  });

  describe('locale keys', () => {
    const E = en as Record<string, string>;
    const F = fr as Record<string, string>;

    it('survey.method_locked exists in en and fr with {current} and {needed}', () => {
      for (const dict of [E, F]) {
        expect(dict['survey.method_locked']).toBeTypeOf('string');
        expect(dict['survey.method_locked']).toContain('{current}');
        expect(dict['survey.method_locked']).toContain('{needed}');
      }
    });

    it('ui.survey.method_locked exists in en and fr with {grade}', () => {
      for (const dict of [E, F]) {
        expect(dict['ui.survey.method_locked']).toBeTypeOf('string');
        expect(dict['ui.survey.method_locked']).toContain('{grade}');
      }
    });

    it('the fr strings differ from the en strings', () => {
      expect(F['survey.method_locked']).not.toBe(E['survey.method_locked']);
      expect(F['ui.survey.method_locked']).not.toBe(E['ui.survey.method_locked']);
    });
  });
});
