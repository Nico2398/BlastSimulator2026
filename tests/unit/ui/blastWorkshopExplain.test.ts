// BlastSimulator2026 — Unit tests: Blast Workshop and blast-report explanation texts (#2168)
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  holeStatusExplain, drillFieldExplain, stemmingExplain, reportStatExplain,
  type HoleStatusKind, type DrillFieldKind, type ReportStatKind,
} from '../../../src/ui/blastWorkshopExplain.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { STEMMING_FULL_DEPTH_FRACTION, STEMMING_MIN_EFFICIENCY } from '../../../src/core/config/balance.js';
import { stemmingFactor, stemmingEfficiency } from '../../../src/core/mining/BlastCalc.js';

afterEach(() => setLocale('en'));

const STATUSES: readonly HoleStatusKind[] = ['wet', 'tubed', 'dry', 'ordered', 'buried'];
// Every DrillFieldKind: a field missing here leaves its explanation untested in both locales.
const FIELDS: readonly DrillFieldKind[] = ['spacing', 'burden', 'depth', 'diameter'];
const STATS: readonly ReportStatKind[] = ['cleared', 'cracked', 'fragments', 'volume', 'projections'];

/** A bare i18n key leaking through t() when a translation is missing. */
const looksLikeKey = (s: string): boolean => /^[a-z_0-9]+(\.[a-z_0-9]+)+$/.test(s.trim());

function sound(text: string): void {
  expect(text.trim().length).toBeGreaterThan(5);
  expect(looksLikeKey(text)).toBe(false);
  expect(text).not.toContain('undefined');
  expect(text).not.toContain('NaN');
}

/** Every text the module can produce, in the current locale. */
function allTexts(): string[] {
  return [
    ...STATUSES.map(holeStatusExplain), ...FIELDS.map(drillFieldExplain),
    stemmingExplain(), ...STATS.map(reportStatExplain),
  ];
}

for (const lang of ['en', 'fr'] as const) {
  describe(`explanation texts (${lang}, #2168)`, () => {
    it('every hole status reads as a sentence, not a key', () => {
      setLocale(lang);
      for (const kind of STATUSES) sound(holeStatusExplain(kind));
    });

    it('every drill setting reads as a sentence, not a key', () => {
      setLocale(lang);
      for (const field of FIELDS) sound(drillFieldExplain(field));
    });

    it('the stemming text reads as a sentence, not a key', () => {
      setLocale(lang);
      sound(stemmingExplain());
    });

    it('every report stat reads as a sentence, not a key', () => {
      setLocale(lang);
      for (const stat of STATS) sound(reportStatExplain(stat));
    });

    it('the texts of one family differ from each other', () => {
      setLocale(lang);
      expect(new Set(STATUSES.map(holeStatusExplain)).size).toBe(STATUSES.length);
      expect(new Set(FIELDS.map(drillFieldExplain)).size).toBe(FIELDS.length);
      expect(new Set(STATS.map(reportStatExplain)).size).toBe(STATS.length);
    });
  });
}

describe('explanation texts across languages (#2168)', () => {
  it('French differs from English for every text', () => {
    setLocale('en');
    const en = allTexts();
    setLocale('fr');
    const fr = allTexts();
    expect(fr).toHaveLength(en.length);
    fr.forEach((text, i) => expect(text, `text #${i}`).not.toBe(en[i]));
  });

  it('a language switch is picked up by the next call', () => {
    setLocale('en');
    const en = holeStatusExplain('wet');
    setLocale('fr');
    expect(holeStatusExplain('wet')).not.toBe(en);
    setLocale('en');
    expect(holeStatusExplain('wet')).toBe(en);
  });

  it('en.json and fr.json declare the same keys', () => {
    const keys = (lang: string): string[] =>
      Object.keys(JSON.parse(readFileSync(`src/core/i18n/locales/${lang}.json`, 'utf8')) as Record<string, string>).sort();
    expect(keys('fr')).toEqual(keys('en'));
  });
});

describe('stemming explanation numbers come from the balance constants (#2168)', () => {
  const fullPct = String(Math.round(STEMMING_FULL_DEPTH_FRACTION * 100));
  const minPct = String(Math.round(STEMMING_MIN_EFFICIENCY * 100));

  for (const lang of ['en', 'fr'] as const) {
    it(`${lang}: names the full-confinement depth fraction and the minimum efficiency as percentages`, () => {
      setLocale(lang);
      const text = stemmingExplain();
      expect(text).toContain(fullPct);
      expect(text).toContain(minPct);
      expect(text).not.toMatch(/\{\w+\}/); // no unfilled placeholder
    });
  }

  it('the constants keep the values the physics always used', () => {
    expect(STEMMING_FULL_DEPTH_FRACTION).toBe(0.3);
    expect(STEMMING_MIN_EFFICIENCY).toBe(0.5);
  });

  it('BlastCalc applies the same constants (behaviour unchanged)', () => {
    const depth = 10;
    expect(stemmingFactor(0, depth)).toBe(0);
    expect(stemmingFactor(depth * STEMMING_FULL_DEPTH_FRACTION, depth)).toBeCloseTo(1, 10);
    expect(stemmingFactor(depth * STEMMING_FULL_DEPTH_FRACTION * 5, depth)).toBe(1);
    expect(stemmingEfficiency(0, depth)).toBeCloseTo(STEMMING_MIN_EFFICIENCY, 10);
    expect(stemmingEfficiency(depth, depth)).toBeCloseTo(1, 10);
    expect(stemmingEfficiency(depth * STEMMING_FULL_DEPTH_FRACTION / 2, depth)).toBeCloseTo(STEMMING_MIN_EFFICIENCY + (1 - STEMMING_MIN_EFFICIENCY) / 2, 10);
  });

  it('a non-positive hole depth leaves no stemming factor', () => {
    expect(stemmingFactor(2, 0)).toBe(0);
    expect(stemmingEfficiency(2, 0)).toBeCloseTo(STEMMING_MIN_EFFICIENCY, 10);
  });
});
