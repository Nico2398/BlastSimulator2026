// BlastSimulator2026 — i18n key resolution tests.
//
// Covers: proficiency labels, policy names, need labels, skill keys, survey
// methods, ore report events, blast damage events, nav pathfinding messages,
// need events (warning/collapsed/shift change), building.full, and
// need.well_rested_bonus interpolation.
//
// Verifies that every key under test resolves (returns a non-empty string that
// is NOT the key itself) in both 'en' and 'fr' locales, and that en/fr
// translations differ for at least one representative key in each group.

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

const NEED_KEYS: NeedKey[] = ['hunger', 'fatigue', 'breakNeed'];

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

// ── Need labels (need.hunger, need.fatigue, need.breakNeed) ───────────────────

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

  it('need.breakNeed is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('need.breakNeed');
    setLocale('fr');
    const fr = t('need.breakNeed');
    expect(en, 'need.breakNeed must resolve in en').not.toBe('need.breakNeed');
    expect(fr, 'need.breakNeed must resolve in fr').not.toBe('need.breakNeed');
    expect(en, 'en and fr translations for need.breakNeed must differ').not.toBe(fr);
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

// ── Need event keys (event.need_warning.*, event.employee_collapsed.*, event.employee_shift_change.*) ─

const NEED_EVENT_KEYS = [
  'event.need_warning.title',
  'event.need_warning.hunger.desc',
  'event.need_warning.fatigue.desc',
  'event.need_warning.breakNeed.desc',
  'event.employee_collapsed.title',
  'event.employee_collapsed.hunger.desc',
  'event.employee_collapsed.fatigue.desc',
  'event.employee_collapsed.breakNeed.desc',
  'event.employee_shift_change.title',
  'event.employee_shift_change.desc',
] as const;

describe('need event keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: all event need keys resolve`, () => {
      setLocale(locale);
      for (const key of NEED_EVENT_KEYS) {
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('need event keys — en and fr translations differ', () => {
  it('event.need_warning.hunger.desc is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('event.need_warning.hunger.desc');
    setLocale('fr');
    const fr = t('event.need_warning.hunger.desc');
    expect(en, 'event.need_warning.hunger.desc must resolve in en').not.toBe('event.need_warning.hunger.desc');
    expect(fr, 'event.need_warning.hunger.desc must resolve in fr').not.toBe('event.need_warning.hunger.desc');
    expect(en, 'en and fr translations for event.need_warning.hunger.desc must differ').not.toBe(fr);
  });

  it('event.employee_collapsed.fatigue.desc is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('event.employee_collapsed.fatigue.desc');
    setLocale('fr');
    const fr = t('event.employee_collapsed.fatigue.desc');
    expect(en, 'event.employee_collapsed.fatigue.desc must resolve in en').not.toBe('event.employee_collapsed.fatigue.desc');
    expect(fr, 'event.employee_collapsed.fatigue.desc must resolve in fr').not.toBe('event.employee_collapsed.fatigue.desc');
    expect(en, 'en and fr translations for event.employee_collapsed.fatigue.desc must differ').not.toBe(fr);
  });

  it('event.employee_shift_change.title is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('event.employee_shift_change.title');
    setLocale('fr');
    const fr = t('event.employee_shift_change.title');
    expect(en, 'event.employee_shift_change.title must resolve in en').not.toBe('event.employee_shift_change.title');
    expect(fr, 'event.employee_shift_change.title must resolve in fr').not.toBe('event.employee_shift_change.title');
    expect(en, 'en and fr translations for event.employee_shift_change.title must differ').not.toBe(fr);
  });
});

// ── building.full key ──────────────────────────────────────────────────────────

describe('building.full key resolves in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: building.full resolves`, () => {
      setLocale(locale);
      const key = 'building.full';
      const result = t(key);
      expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
      expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
    });
  }
});

describe('building.full — en and fr translations differ', () => {
  it('building.full is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('building.full');
    setLocale('fr');
    const fr = t('building.full');
    expect(en, 'building.full must resolve in en').not.toBe('building.full');
    expect(fr, 'building.full must resolve in fr').not.toBe('building.full');
    expect(en, 'en and fr translations for building.full must differ').not.toBe(fr);
  });
});

// ── need.well_rested_bonus key ─────────────────────────────────────────────────

describe('need.well_rested_bonus key resolves in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: need.well_rested_bonus resolves`, () => {
      setLocale(locale);
      const key = 'need.well_rested_bonus';
      const result = t(key);
      expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
      expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
    });
  }
});

describe('need.well_rested_bonus — en and fr translations differ', () => {
  it('need.well_rested_bonus is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('need.well_rested_bonus');
    setLocale('fr');
    const fr = t('need.well_rested_bonus');
    expect(en, 'need.well_rested_bonus must resolve in en').not.toBe('need.well_rested_bonus');
    expect(fr, 'need.well_rested_bonus must resolve in fr').not.toBe('need.well_rested_bonus');
    expect(en, 'en and fr translations for need.well_rested_bonus must differ').not.toBe(fr);
  });
});

describe('need.well_rested_bonus — {amount} / {threshold} interpolation', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: need.well_rested_bonus interpolates {amount} and {threshold}`, () => {
      setLocale(locale);
      const key = 'need.well_rested_bonus';
      const result = t(key, { amount: 10, threshold: 5 });
      expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
      expect(result, `interpolated string "${result}" must contain the amount value`).toContain('10');
      expect(result, `interpolated string "${result}" must contain the threshold value`).toContain('5');
    });
  }
});

// ── Level tutorial_pit keys ──────────────────────────────────────────────

const LEVEL_TUTORIAL_PIT_KEYS = [
  'level.tutorial_pit.name',
  'level.tutorial_pit.desc',
] as const;

describe('level.tutorial_pit name & desc keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: level.tutorial_pit name and desc resolve`, () => {
      setLocale(locale);
      for (const key of LEVEL_TUTORIAL_PIT_KEYS) {
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('level.tutorial_pit keys — en and fr translations differ', () => {
  it('level.tutorial_pit.desc is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('level.tutorial_pit.desc');
    setLocale('fr');
    const fr = t('level.tutorial_pit.desc');
    expect(en, 'level.tutorial_pit.desc must resolve in en').not.toBe('level.tutorial_pit.desc');
    expect(fr, 'level.tutorial_pit.desc must resolve in fr').not.toBe('level.tutorial_pit.desc');
    expect(en, 'en and fr translations for level.tutorial_pit.desc must differ').not.toBe(fr);
  });
});

// ── Tutorial synergy consultant event keys (event.tutorial_synergy_consultant.*) ─

const TUTORIAL_SYNERGY_CONSULTANT_KEYS = [
  'event.tutorial_synergy_consultant.title',
  'event.tutorial_synergy_consultant.desc',
  'event.tutorial_synergy_consultant.opt0',
  'event.tutorial_synergy_consultant.opt1',
  'event.tutorial_synergy_consultant.opt2',
] as const;

describe('tutorial_synergy_consultant event keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: all event.tutorial_synergy_consultant.* keys resolve`, () => {
      setLocale(locale);
      for (const key of TUTORIAL_SYNERGY_CONSULTANT_KEYS) {
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('tutorial_synergy_consultant event keys — en and fr translations differ', () => {
  it('event.tutorial_synergy_consultant.title is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('event.tutorial_synergy_consultant.title');
    setLocale('fr');
    const fr = t('event.tutorial_synergy_consultant.title');
    expect(en, 'event.tutorial_synergy_consultant.title must resolve in en').not.toBe('event.tutorial_synergy_consultant.title');
    expect(fr, 'event.tutorial_synergy_consultant.title must resolve in fr').not.toBe('event.tutorial_synergy_consultant.title');
    expect(en, 'en and fr translations for event.tutorial_synergy_consultant.title must differ').not.toBe(fr);
  });

  it('event.tutorial_synergy_consultant.opt0 is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('event.tutorial_synergy_consultant.opt0');
    setLocale('fr');
    const fr = t('event.tutorial_synergy_consultant.opt0');
    expect(en, 'event.tutorial_synergy_consultant.opt0 must resolve in en').not.toBe('event.tutorial_synergy_consultant.opt0');
    expect(fr, 'event.tutorial_synergy_consultant.opt0 must resolve in fr').not.toBe('event.tutorial_synergy_consultant.opt0');
    expect(en, 'en and fr translations for event.tutorial_synergy_consultant.opt0 must differ').not.toBe(fr);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Issue #457 — new/reworked keys for the i18n bug fixes
//
// Key names below (ui.tile_select.*, menu.subtitle, ui.minimap.no_data,
// notification.*, menu.level_locked's {threshold}/{level} params) are this
// test's expectation for what the implementer adds to en.json/fr.json.
// These do not exist yet on this branch, so every "resolves" assertion below
// is expected to fail RED (t() returns the key itself for a missing key).
// ═══════════════════════════════════════════════════════════════════════════

// TileSelectOverlay and its ui.tile_select.{no_selection,confirm,cancel,
// selected_point,selected_area,drag_hint,pick_hint} keys were retired in P3
// (in-scene placement replaced the 2D picker) — the coverage that used to
// live here went with it. ui.tile_select.tiles survives (BlastPlanUI/
// BuildMenu's result readouts) and is covered by the general key-parity scan.

// ── MainMenu subtitle (menu.subtitle) ──────────────────────────────────────

describe('menu.subtitle key resolves in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: menu.subtitle resolves`, () => {
      setLocale(locale);
      const result = t('menu.subtitle');
      expect(result, 'menu.subtitle must resolve').not.toBe('menu.subtitle');
      expect(result.length).toBeGreaterThan(0);
    });
  }
});

describe('menu.subtitle — en and fr translations differ', () => {
  it('menu.subtitle is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('menu.subtitle');
    setLocale('fr');
    const fr = t('menu.subtitle');
    expect(en).not.toBe('menu.subtitle');
    expect(fr).not.toBe('menu.subtitle');
    expect(en).not.toBe(fr);
  });
});

// ── MiniMap "no data" placeholder (ui.minimap.no_data) ─────────────────────

describe('ui.minimap.no_data key resolves in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: ui.minimap.no_data resolves`, () => {
      setLocale(locale);
      const result = t('ui.minimap.no_data');
      expect(result, 'ui.minimap.no_data must resolve').not.toBe('ui.minimap.no_data');
      expect(result.length).toBeGreaterThan(0);
    });
  }
});

describe('ui.minimap.no_data — en and fr translations differ', () => {
  it('ui.minimap.no_data is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('ui.minimap.no_data');
    setLocale('fr');
    const fr = t('ui.minimap.no_data');
    expect(en).not.toBe('ui.minimap.no_data');
    expect(fr).not.toBe('ui.minimap.no_data');
    expect(en).not.toBe(fr);
  });
});

// ── main.ts notification keys (notification.*) ─────────────────────────────

const NOTIFICATION_KEYS = [
  'notification.bankruptcy_triggered',
  'notification.bankruptcy_warning',
  'notification.ecology_shutdown',
  'notification.ecology_warning',
  'notification.arrest_triggered',
  'notification.revolt_triggered',
  'notification.revolt_warning',
] as const;

describe('notification.* keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: all 7 notification.* keys resolve`, () => {
      setLocale(locale);
      for (const key of NOTIFICATION_KEYS) {
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('notification.* keys — en and fr translations differ', () => {
  for (const key of NOTIFICATION_KEYS) {
    it(`${key} is translated differently in en vs fr`, () => {
      setLocale('en');
      const en = t(key);
      setLocale('fr');
      const fr = t(key);
      expect(en, `${key} must resolve in en`).not.toBe(key);
      expect(fr, `${key} must resolve in fr`).not.toBe(key);
      expect(en, `en and fr translations for ${key} must differ`).not.toBe(fr);
    });
  }
});

describe('notification.bankruptcy_warning / ecology_warning / revolt_warning — {ticksRemaining} interpolation', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: warning notifications interpolate {ticksRemaining}`, () => {
      setLocale(locale);
      for (const key of ['notification.bankruptcy_warning', 'notification.ecology_warning', 'notification.revolt_warning']) {
        const result = t(key, { ticksRemaining: 42 });
        expect(result, `key "${key}" must resolve`).not.toBe(key);
        expect(result, `"${result}" must contain the ticksRemaining value`).toContain('42');
      }
    });
  }
});

// ── menu.level_locked reworked with {threshold}/{level} params ─────────────
//
// The current template takes a single {req} param that MainMenu.ts builds in
// plain JS as `$X on <level name>` — baking the English word "on" into every
// locale. The fix moves the connecting word into the template itself, keyed
// on {threshold} and {level}.

describe('menu.level_locked — reworked {threshold}/{level} interpolation', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: menu.level_locked interpolates {threshold} and {level}`, () => {
      setLocale(locale);
      const result = t('menu.level_locked', { threshold: '$250,000', level: 'Dusty Hollow' });
      expect(result, 'menu.level_locked must resolve').not.toBe('menu.level_locked');
      expect(result, `"${result}" must contain the threshold value`).toContain('$250,000');
      expect(result, `"${result}" must contain the level value`).toContain('Dusty Hollow');
    });
  }

  it('the French render never contains the standalone English word "on"', () => {
    setLocale('fr');
    const result = t('menu.level_locked', { threshold: '$250,000', level: 'La Combe Poussiéreuse' });
    expect(result).not.toMatch(/\bon\b/);
  });
});
