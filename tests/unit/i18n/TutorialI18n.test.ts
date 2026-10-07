// BlastSimulator2026 — CH1.6: i18n key resolution tests for tutorial steps
//
// Verifies that every tutorial key resolves (i.e. returns a non-empty string
// that is not the key itself) in both 'en' and 'fr' locales, and that en/fr
// translations differ for representative keys.
//
// 50 keys exist from merged #318 (title, skip, next, step1–23, step1–23.title, done).
// 3 keys will be added by #319 (progress, complete_title, complete_text).
// Total: 53 keys across 2 locales.
// #923: tutorial.step1/.title (the old standalone 'time-speed' step's copy)
// no longer exist — the step moved into the box-cut wait and split into two
// new named keys (tutorial.step_speedupdig/tutorial.step_speednormalafterdig, plus
// their own .title and stage keys), the same box-cut-style naming already
// used for tutorial.step_boxcut below.
// #1015: those two keys (and their .title/stage keys) are removed again — the
// speed-up-for-dig/speed-normal-after-dig steps are gone, since the speed bar
// is unconditionally player-controlled from the tutorial's first step onward
// and needs no dedicated lesson.

import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';

const LOCALES = ['en', 'fr'] as const;

function generateAllTutorialKeys(): string[] {
  const keys = [
    'tutorial.title',
    'tutorial.skip',
    'tutorial.next',
    'tutorial.progress',
  ];
  // Step 18 (the late ramp step) was replaced by the box-cut step, which sits
  // early in the flow and has its own named key. Step 1 (#923) was replaced
  // by the speed-up-for-dig/speed-normal-after-dig pair, which also sit
  // elsewhere in the flow (inside the box-cut wait) and have their own named
  // keys.
  for (let i = 1; i <= 23; i++) {
    // #1328: steps 20-22 (set-policy/tick-advance/victory) became free-play.
    // #1335: step 12 (contract-accept) removed.
    if (i === 1 || i === 12 || i === 18 || (i >= 20 && i <= 22)) continue;
    keys.push(`tutorial.step${i}`);
  }
  for (let i = 1; i <= 23; i++) {
    // #1328: steps 20-22 (set-policy/tick-advance/victory) became free-play.
    // #1335: step 12 (contract-accept) removed.
    if (i === 1 || i === 12 || i === 18 || (i >= 20 && i <= 22)) continue;
    keys.push(`tutorial.step${i}.title`);
  }
  keys.push('tutorial.free_play', 'tutorial.free_play.title', 'tutorial.goal_chip', 'tutorial.goal_chip_tooltip');
  keys.push('tutorial.step_boxcut', 'tutorial.step_boxcut.title', 'tutorial.stage.boxcut_area');
  keys.push(
    'tutorial.done',
    'tutorial.complete_title',
    'tutorial.complete_text',
  );
  return keys;
}

const ALL_TUTORIAL_KEYS = generateAllTutorialKeys();

beforeEach(() => {
  setLocale('en');
});

// ── All 53 keys resolve in both locales ─────────────────────────────────────

describe('all tutorial keys resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: all ${ALL_TUTORIAL_KEYS.length} tutorial keys resolve to non-empty strings`, () => {
      setLocale(locale);
      for (const key of ALL_TUTORIAL_KEYS) {
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

// ── The 3 new keys resolve in both locales (will fail initially) ─────────────

describe('new tutorial keys resolve in both locales', () => {
  const NEW_KEYS = ['tutorial.progress', 'tutorial.complete_title', 'tutorial.complete_text'];

  for (const locale of LOCALES) {
    it(`locale ${locale}: all 3 new tutorial keys resolve`, () => {
      setLocale(locale);
      for (const key of NEW_KEYS) {
        const result = t(key);
        expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
        expect(result.length, `key "${key}" must be non-empty in ${locale}`).toBeGreaterThan(0);
      }
    });
  }
});

// ── en/fr translations differ for representative keys ───────────────────────

describe('tutorial keys — en and fr translations differ', () => {
  it('tutorial.progress is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('tutorial.progress');
    setLocale('fr');
    const fr = t('tutorial.progress');
    expect(en, 'tutorial.progress must resolve in en').not.toBe('tutorial.progress');
    expect(fr, 'tutorial.progress must resolve in fr').not.toBe('tutorial.progress');
    expect(en, 'en and fr translations for tutorial.progress must differ').not.toBe(fr);
  });

  it('tutorial.complete_title is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('tutorial.complete_title');
    setLocale('fr');
    const fr = t('tutorial.complete_title');
    expect(en, 'tutorial.complete_title must resolve in en').not.toBe('tutorial.complete_title');
    expect(fr, 'tutorial.complete_title must resolve in fr').not.toBe('tutorial.complete_title');
    expect(en, 'en and fr translations for tutorial.complete_title must differ').not.toBe(fr);
  });

  it('tutorial.complete_text is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('tutorial.complete_text');
    setLocale('fr');
    const fr = t('tutorial.complete_text');
    expect(en, 'tutorial.complete_text must resolve in en').not.toBe('tutorial.complete_text');
    expect(fr, 'tutorial.complete_text must resolve in fr').not.toBe('tutorial.complete_text');
    expect(en, 'en and fr translations for tutorial.complete_text must differ').not.toBe(fr);
  });
});

// ── #1335: contract-accept card removed, sell-ore copy reworded ─────────────

import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };
import { GLOSSARY } from '../../../src/core/i18n/glossary.js';

describe('#1335: contract-accept locale keys are gone', () => {
  const REMOVED = ['tutorial.step12', 'tutorial.step12.title', 'tutorial.stage.contract_accept'];
  for (const [name, data] of [['en', enLocale], ['fr', frLocale]] as const) {
    it(`${name}.json carries none of ${REMOVED.join(', ')}`, () => {
      for (const key of REMOVED) {
        expect(key in (data as Record<string, string>), `${key} still in ${name}.json`).toBe(false);
      }
    });
  }

  it('no glossary entry lists tutorial.step12 among its relevantKeys', () => {
    for (const entry of GLOSSARY) {
      expect(entry.relevantKeys ?? [], entry.concept).not.toContain('tutorial.step12');
    }
  });
});

describe('#1335: sell-ore copy tells the player to accept an offer for ore already stored', () => {
  it('en: step and stage text mention stored ore and greyed (unfillable) offers', () => {
    const data = enLocale as Record<string, string>;
    for (const key of ['tutorial.step_sellore', 'tutorial.stage.sell_ore']) {
      const text = data[key]!.toLowerCase();
      expect(text, key).toMatch(/stor(ed|age)/);
      expect(text, key).toContain('accept');
    }
    expect(data['tutorial.step_sellore']!.toLowerCase()).toMatch(/grey|gray/);
  });

  it('fr: step and stage text were reworded alongside en', () => {
    const fr = frLocale as Record<string, string>;
    const en = enLocale as Record<string, string>;
    for (const key of ['tutorial.step_sellore', 'tutorial.stage.sell_ore']) {
      expect(fr[key], key).toBeTruthy();
      expect(fr[key], key).not.toBe(en[key]);
    }
    expect(fr['tutorial.step_sellore']!.toLowerCase()).toMatch(/gris|grisé/);
  });
});
