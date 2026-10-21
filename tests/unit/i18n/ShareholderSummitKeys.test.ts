import { describe, it, expect } from 'vitest';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;
const KEYS = [
  'level.shareholder_summit.name',
  'level.shareholder_summit.desc',
  'ui.portfolio.biome.volcanic',
];

describe('shareholder summit i18n keys (#1949)', () => {
  for (const k of KEYS) {
    it(`${k} exists, non-empty, in en and fr and differs between them`, () => {
      expect(en[k], `en ${k}`).toBeTruthy();
      expect(fr[k], `fr ${k}`).toBeTruthy();
      expect(fr[k]).not.toBe(en[k]);
    });
  }

  it('names the level in both languages', () => {
    expect(en['level.shareholder_summit.name']).toBe('Shareholder Summit');
    expect(fr['level.shareholder_summit.name']).toBe('Sommet des actionnaires');
  });

  it('carries the approved English blurb', () => {
    expect(en['level.shareholder_summit.desc']).toBe(
      'The mine went public. Congratulations: you now work for people who have never seen a rock.',
    );
  });
});
