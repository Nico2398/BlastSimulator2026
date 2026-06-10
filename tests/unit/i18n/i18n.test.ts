// BlastSimulator2026 — CH3.14 + CH4.9: i18n key resolution tests for proficiency
// labels, policy names, need labels, skill keys, survey methods, and ore report
// events.
//
// Verifies that every key in the proficiency.*, policy.*, need.*, skill.*,
// survey.*, and event.(lucky_strike|barren_blast|legendary_vein|absurdium_jackpot).*
// namespaces resolves (i.e. returns a non-empty string that is NOT the key
// itself) in both 'en' and 'fr' locales, and that en/fr translations differ
// for at least one representative key in each group.

import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import type { ShiftMode } from '../../../src/core/entities/SitePolicy.js';
import type { NeedKey }   from '../../../src/core/entities/EmployeeNeeds.js';
import { SURVEY_METHODS } from '../../../src/core/mining/SurveyCalc.js';
import { ORE_REPORT_EVENTS } from '../../../src/core/events/OreReportEvents.js';

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

const SURVEY_METHOD_KEYS = SURVEY_METHODS.map(method => `survey.${method}`);

const ORE_REPORT_EVENT_KEYS = ORE_REPORT_EVENTS.flatMap(event => [
  event.titleKey,
  event.descKey,
  ...event.options.map(option => option.labelKey),
]);

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

// ── Survey method names (survey.seismic, survey.core_sample, survey.aerial) ──

describe('survey method keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: all survey.* keys resolve`, () => {
      setLocale(locale);
      for (const key of SURVEY_METHOD_KEYS) {
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('survey method keys — en and fr translations differ', () => {
  it('survey.seismic is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('survey.seismic');
    setLocale('fr');
    const fr = t('survey.seismic');
    expect(en, 'survey.seismic must resolve in en').not.toBe('survey.seismic');
    expect(fr, 'survey.seismic must resolve in fr').not.toBe('survey.seismic');
    expect(en, 'en and fr translations for survey.seismic must differ').not.toBe(fr);
  });
});

// ── Ore report event keys (event.lucky_strike.*, event.barren_blast.*, event.legendary_vein.*, event.absurdium_jackpot.*) ─

describe('ore report event keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: all ore report event keys resolve`, () => {
      setLocale(locale);
      for (const key of ORE_REPORT_EVENT_KEYS) {
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('ore report event keys — en and fr translations differ', () => {
  it('event.lucky_strike.title is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('event.lucky_strike.title');
    setLocale('fr');
    const fr = t('event.lucky_strike.title');
    expect(en, 'event.lucky_strike.title must resolve in en').not.toBe('event.lucky_strike.title');
    expect(fr, 'event.lucky_strike.title must resolve in fr').not.toBe('event.lucky_strike.title');
    expect(en, 'en and fr translations for event.lucky_strike.title must differ').not.toBe(fr);
  });

  it('event.absurdium_jackpot.desc is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('event.absurdium_jackpot.desc');
    setLocale('fr');
    const fr = t('event.absurdium_jackpot.desc');
    expect(en, 'event.absurdium_jackpot.desc must resolve in en').not.toBe('event.absurdium_jackpot.desc');
    expect(fr, 'event.absurdium_jackpot.desc must resolve in fr').not.toBe('event.absurdium_jackpot.desc');
    expect(en, 'en and fr translations for event.absurdium_jackpot.desc must differ').not.toBe(fr);
  });
});

// ── Blast damage event keys (event.blast_damage.*) ─────────────────────────

const BLAST_DAMAGE_EVENT_KEYS = [
  'event.blast_damage.title',
  'event.blast_damage.desc',
  'event.blast_damage.opt0',
  'event.blast_damage.opt1',
  'event.blast_damage.opt2',
] as const;

describe('blast damage event keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: all event.blast_damage.* keys resolve`, () => {
      setLocale(locale);
      for (const key of BLAST_DAMAGE_EVENT_KEYS) {
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('blast damage event keys — en and fr translations differ', () => {
  it('event.blast_damage.title is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('event.blast_damage.title');
    setLocale('fr');
    const fr = t('event.blast_damage.title');
    expect(en, 'event.blast_damage.title must resolve in en').not.toBe('event.blast_damage.title');
    expect(fr, 'event.blast_damage.title must resolve in fr').not.toBe('event.blast_damage.title');
    expect(en, 'en and fr translations for event.blast_damage.title must differ').not.toBe(fr);
  });

  it('event.blast_damage.opt0 is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('event.blast_damage.opt0');
    setLocale('fr');
    const fr = t('event.blast_damage.opt0');
    expect(en, 'event.blast_damage.opt0 must resolve in en').not.toBe('event.blast_damage.opt0');
    expect(fr, 'event.blast_damage.opt0 must resolve in fr').not.toBe('event.blast_damage.opt0');
    expect(en, 'en and fr translations for event.blast_damage.opt0 must differ').not.toBe(fr);
  });
});

// ── Oversized fragment alert (blast.oversized_alert) ───────────────────────

describe('blast.oversized_alert key resolves in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: blast.oversized_alert resolves`, () => {
      setLocale(locale);
      const key = 'blast.oversized_alert';
      const result = t(key);
      expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
      expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
    });
  }
});

describe('blast.oversized_alert — en and fr translations differ', () => {
  it('blast.oversized_alert is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('blast.oversized_alert');
    setLocale('fr');
    const fr = t('blast.oversized_alert');
    expect(en, 'blast.oversized_alert must resolve in en').not.toBe('blast.oversized_alert');
    expect(fr, 'blast.oversized_alert must resolve in fr').not.toBe('blast.oversized_alert');
    expect(en, 'en and fr translations for blast.oversized_alert must differ').not.toBe(fr);
  });
});

describe('blast.oversized_alert — {count} interpolation', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: blast.oversized_alert interpolates {count}`, () => {
      setLocale(locale);
      const key = 'blast.oversized_alert';
      const result = t(key, { count: 3 });
      expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
      expect(result, `interpolated string "${result}" must contain the count value`).toContain('3');
    });
  }
});

// ── Nav pathfinding event keys (nav.agent_stuck, nav.no_ramp_available) ──────

const NAV_KEYS = [
  'nav.agent_stuck',
  'nav.no_ramp_available',
] as const;

describe('nav.* keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: all nav.* keys resolve`, () => {
      setLocale(locale);
      for (const key of NAV_KEYS) {
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('nav.* keys — en and fr translations differ', () => {
  it('nav.agent_stuck is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('nav.agent_stuck');
    setLocale('fr');
    const fr = t('nav.agent_stuck');
    expect(en, 'nav.agent_stuck must resolve in en').not.toBe('nav.agent_stuck');
    expect(fr, 'nav.agent_stuck must resolve in fr').not.toBe('nav.agent_stuck');
    expect(en, 'en and fr translations for nav.agent_stuck must differ').not.toBe(fr);
  });

  it('nav.no_ramp_available is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('nav.no_ramp_available');
    setLocale('fr');
    const fr = t('nav.no_ramp_available');
    expect(en, 'nav.no_ramp_available must resolve in en').not.toBe('nav.no_ramp_available');
    expect(fr, 'nav.no_ramp_available must resolve in fr').not.toBe('nav.no_ramp_available');
    expect(en, 'en and fr translations for nav.no_ramp_available must differ').not.toBe(fr);
  });
});
