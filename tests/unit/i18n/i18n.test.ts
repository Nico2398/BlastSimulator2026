// BlastSimulator2026 — CH3.14: i18n key resolution tests for proficiency labels,
// policy names, need labels, and skill keys.
//
// Verifies that every key in the proficiency.*, policy.*, need.*, and skill.*
// namespaces resolves (i.e. returns a non-empty string that is NOT the key
// itself) in both 'en' and 'fr' locales, and that en/fr translations differ
// for at least one representative key in each group.

import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import type { ShiftMode } from '../../../src/core/entities/SitePolicy.js';
import type { NeedKey }   from '../../../src/core/entities/EmployeeNeeds.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCALES = ['en', 'fr'] as const;

const PROFICIENCY_LEVELS = [1, 2, 3, 4, 5] as const;

const SHIFT_MODES: ShiftMode[] = ['shift_8h', 'shift_12h', 'continuous', 'custom'];

const NEED_KEYS: NeedKey[] = ['hunger', 'fatigue', 'social', 'comfort'];

const SKILL_KEYS = [
  'skill.blasting',
  'skill.driving.truck',
  'skill.driving.excavator',
  'skill.driving.drill_rig',
  'skill.geology',
  'skill.management',
] as const;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  setLocale('en');
});

// ── Proficiency labels (proficiency.1 – proficiency.5) ───────────────────────

describe('proficiency label keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: proficiency.1–5 resolve`, () => {
      setLocale(locale);
      for (const level of PROFICIENCY_LEVELS) {
        const key = `proficiency.${level}`;
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('proficiency labels — en and fr translations differ', () => {
  it('proficiency.1 is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('proficiency.1');
    setLocale('fr');
    const fr = t('proficiency.1');
    expect(en, 'proficiency.1 must resolve in en').not.toBe('proficiency.1');
    expect(fr, 'proficiency.1 must resolve in fr').not.toBe('proficiency.1');
    expect(en, 'en and fr translations for proficiency.1 must differ').not.toBe(fr);
  });

  it('proficiency.5 is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('proficiency.5');
    setLocale('fr');
    const fr = t('proficiency.5');
    expect(en, 'proficiency.5 must resolve in en').not.toBe('proficiency.5');
    expect(fr, 'proficiency.5 must resolve in fr').not.toBe('proficiency.5');
    expect(en, 'en and fr translations for proficiency.5 must differ').not.toBe(fr);
  });
});

// ── Policy names (policy.shift_8h, policy.shift_12h, policy.continuous, policy.custom) ─

describe('policy name keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: all policy.* keys resolve`, () => {
      setLocale(locale);
      for (const mode of SHIFT_MODES) {
        const key = `policy.${mode}`;
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('policy name keys — en and fr translations differ', () => {
  it('policy.shift_8h is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('policy.shift_8h');
    setLocale('fr');
    const fr = t('policy.shift_8h');
    expect(en, 'policy.shift_8h must resolve in en').not.toBe('policy.shift_8h');
    expect(fr, 'policy.shift_8h must resolve in fr').not.toBe('policy.shift_8h');
    expect(en, 'en and fr translations for policy.shift_8h must differ').not.toBe(fr);
  });

  it('policy.continuous is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('policy.continuous');
    setLocale('fr');
    const fr = t('policy.continuous');
    expect(en, 'policy.continuous must resolve in en').not.toBe('policy.continuous');
    expect(fr, 'policy.continuous must resolve in fr').not.toBe('policy.continuous');
    expect(en, 'en and fr translations for policy.continuous must differ').not.toBe(fr);
  });
});

// ── Need labels (need.hunger, need.fatigue, need.social, need.comfort) ────────

describe('need label keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: all need.* keys resolve`, () => {
      setLocale(locale);
      for (const need of NEED_KEYS) {
        const key = `need.${need}`;
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('need label keys — en and fr translations differ', () => {
  it('need.hunger is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('need.hunger');
    setLocale('fr');
    const fr = t('need.hunger');
    expect(en, 'need.hunger must resolve in en').not.toBe('need.hunger');
    expect(fr, 'need.hunger must resolve in fr').not.toBe('need.hunger');
    expect(en, 'en and fr translations for need.hunger must differ').not.toBe(fr);
  });

  it('need.comfort is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('need.comfort');
    setLocale('fr');
    const fr = t('need.comfort');
    expect(en, 'need.comfort must resolve in en').not.toBe('need.comfort');
    expect(fr, 'need.comfort must resolve in fr').not.toBe('need.comfort');
    expect(en, 'en and fr translations for need.comfort must differ').not.toBe(fr);
  });
});

// ── Skill keys (already exist — these should PASS immediately) ────────────────

describe('skill label keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: all skill.* keys resolve`, () => {
      setLocale(locale);
      for (const key of SKILL_KEYS) {
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('skill label keys — en and fr translations differ', () => {
  it('skill.blasting is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('skill.blasting');
    setLocale('fr');
    const fr = t('skill.blasting');
    expect(en, 'skill.blasting must resolve in en').not.toBe('skill.blasting');
    expect(fr, 'skill.blasting must resolve in fr').not.toBe('skill.blasting');
    expect(en, 'en and fr translations for skill.blasting must differ').not.toBe(fr);
  });

  it('skill.driving.truck is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('skill.driving.truck');
    setLocale('fr');
    const fr = t('skill.driving.truck');
    expect(en, 'skill.driving.truck must resolve in en').not.toBe('skill.driving.truck');
    expect(fr, 'skill.driving.truck must resolve in fr').not.toBe('skill.driving.truck');
    expect(en, 'en and fr translations for skill.driving.truck must differ').not.toBe(fr);
  });
});
