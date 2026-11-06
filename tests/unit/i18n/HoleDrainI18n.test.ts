// BlastSimulator2026 — hole drain / tubing-ahead i18n keys (#1350)

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';

const load = (loc: string) =>
  JSON.parse(readFileSync(`src/core/i18n/locales/${loc}.json`, 'utf8')) as Record<string, string>;

const UI_KEYS = [
  'ui.blast_workshop.charge.drain_holes',
  'ui.blast_workshop.charge.drain_none_reason',
  'ui.blast_workshop.charge.drain_porous_reason',
  'ui.blast_workshop.charge.tubing_ahead',
];

afterEach(() => setLocale('en'));

describe('hole drain i18n (#1350)', () => {
  it.each(UI_KEYS)('%s exists in en and fr with different text', key => {
    const en = load('en');
    const fr = load('fr');
    expect(en[key]).toBeTruthy();
    expect(fr[key]).toBeTruthy();
    expect(fr[key]).not.toBe(en[key]);
  });

  it.each(UI_KEYS)('%s resolves through t() in both locales', key => {
    for (const loc of ['en', 'fr'] as const) {
      setLocale(loc);
      const text = t(key, { count: 3 });
      expect(text).not.toBe(key);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  describe('hole-count plurals (#2149)', () => {
    const COUNTED = [
      'ui.blast_workshop.charge.tubing_needed',
      'ui.blast_workshop.charge.tubing_ahead',
    ];

    it.each(COUNTED)('%s has a _one variant in en and fr, distinct from the plural and between locales', key => {
      const en = load('en');
      const fr = load('fr');
      expect(en[`${key}_one`]).toBeTruthy();
      expect(fr[`${key}_one`]).toBeTruthy();
      expect(en[`${key}_one`]).not.toBe(en[key]);
      expect(fr[`${key}_one`]).not.toBe(fr[key]);
      expect(fr[`${key}_one`]).not.toBe(en[`${key}_one`]);
    });

    it.each(COUNTED)('%s_one names one hole, not several', key => {
      expect(load('en')[`${key}_one`]).not.toMatch(/\bholes\b/i);
      expect(load('fr')[`${key}_one`]).not.toMatch(/\btrous\b/i);
    });

    it.each(COUNTED)('%s_one resolves through t() in both locales', key => {
      for (const loc of ['en', 'fr'] as const) {
        setLocale(loc);
        const text = t(`${key}_one`, { count: 1 });
        expect(text).not.toBe(`${key}_one`);
        expect(text.length).toBeGreaterThan(0);
      }
    });

    it('en and fr define the same set of charge _one keys', () => {
      const pick = (d: Record<string, string>) =>
        Object.keys(d).filter(k => k.startsWith('ui.blast_workshop.charge.') && k.endsWith('_one')).sort();
      const enKeys = pick(load('en'));
      expect(enKeys.length).toBeGreaterThanOrEqual(COUNTED.length);
      expect(pick(load('fr'))).toEqual(enKeys);
    });

    it('the plural variants still say holes, so only 1 is singular', () => {
      expect(load('en')[COUNTED[0]!]).toMatch(/\bholes\b/i);
      expect(load('en')[COUNTED[1]!]).toMatch(/\bholes\b/i);
      expect(load('fr')[COUNTED[0]!]).toMatch(/\btrous\b/i);
      expect(load('fr')[COUNTED[1]!]).toMatch(/\btrous\b/i);
    });
  });

  it('mining.drain.* has the same non-empty key set in en and fr', () => {
    const pick = (d: Record<string, string>) => Object.keys(d).filter(k => k.startsWith('mining.drain.')).sort();
    const enKeys = pick(load('en'));
    expect(enKeys.length).toBeGreaterThanOrEqual(3);
    expect(pick(load('fr'))).toEqual(enKeys);
    for (const k of enKeys) {
      expect(load('en')[k]).toBeTruthy();
      expect(load('fr')[k]).toBeTruthy();
    }
  });
});
