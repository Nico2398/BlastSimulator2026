// BlastSimulator2026 — CH1.6: i18n key resolution tests for tutorial steps
//
// Verifies that every tutorial key resolves (i.e. returns a non-empty string
// that is not the key itself) in both 'en' and 'fr' locales, and that en/fr
// translations differ for representative keys.
//
// 50 keys exist from merged #318 (title, skip, next, step1–23, step1–23.title, done).
// 3 keys will be added by #319 (progress, complete_title, complete_text).
// Total: 53 keys across 2 locales.

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
  for (let i = 1; i <= 23; i++) {
    keys.push(`tutorial.step${i}`);
  }
  for (let i = 1; i <= 23; i++) {
    keys.push(`tutorial.step${i}.title`);
  }
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

  it('tutorial.step1.title is translated differently in en vs fr', () => {
    setLocale('en');
    const en = t('tutorial.step1.title');
    setLocale('fr');
    const fr = t('tutorial.step1.title');
    expect(en, 'tutorial.step1.title must resolve in en').not.toBe('tutorial.step1.title');
    expect(fr, 'tutorial.step1.title must resolve in fr').not.toBe('tutorial.step1.title');
    expect(en, 'en and fr translations for tutorial.step1.title must differ').not.toBe(fr);
  });
});
