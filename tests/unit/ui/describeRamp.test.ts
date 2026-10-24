// BlastSimulator2026 — Unit tests: ramp title/subline incl. grade and the single climbable line (#1938, #2045)

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeRamp } from '../../../src/ui/describeRamp.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import type { BuiltRamp } from '../../../src/core/state/GameState.js';

const RAMP: BuiltRamp = {
  id: 3,
  width: 3,
  def: { originX: 10, originZ: 5, direction: 'south', length: 12, targetDepth: 6, width: 3 },
  footprint: { minX: 9, maxX: 11, minZ: 5, maxZ: 16 },
};

const localeKeys = (locale: 'en' | 'fr'): Record<string, string> =>
  JSON.parse(readFileSync(join(__dirname, `../../../src/core/i18n/locales/${locale}.json`), 'utf8'));

describe('describeRamp', () => {
  beforeEach(() => setLocale('en'));

  it('without climb info keeps the existing id / length / width line', () => {
    const base = describeRamp(RAMP);
    expect(base.sub).toContain('#3');
    expect(base.sub).toContain('12m long');
  });

  it('adds the ramp grade to the detail line', () => {
    const plain = describeRamp(RAMP);
    const withGrade = describeRamp(RAMP, { gradeDeg: 26, climbable: false, maxDeg: 20 });
    expect(withGrade.sub).not.toBe(plain.sub);
    expect(withGrade.sub).toContain('26°');
  });

  it('adds one climbable clause naming the limit for a gentle ramp', () => {
    const out = describeRamp(RAMP, { gradeDeg: 15, climbable: true, maxDeg: 20 });
    expect(out.sub).toContain(t('shell.selection.ramp_climbable', { max: 20 }));
    expect(out.sub).toContain('15°');
  });

  it('adds one not-climbable clause naming the limit for a steep ramp', () => {
    const out = describeRamp(RAMP, { gradeDeg: 26, climbable: false, maxDeg: 20 });
    expect(out.sub).toContain(t('shell.selection.ramp_not_climbable', { max: 20 }));
    expect(out.sub).not.toContain(t('shell.selection.ramp_climbable', { max: 20 }));
  });

  it('climbable and not climbable read differently', () => {
    expect(describeRamp(RAMP, { gradeDeg: 15, climbable: true, maxDeg: 20 }).sub)
      .not.toBe(describeRamp(RAMP, { gradeDeg: 26, climbable: false, maxDeg: 20 }).sub);
  });

  it('names no vehicle tier', () => {
    for (const climbable of [true, false]) {
      expect(describeRamp(RAMP, { gradeDeg: 22, climbable, maxDeg: 20 }).sub).not.toMatch(/\btier\b|\bT[123]\b/i);
    }
  });

  it('rounds a fractional grade for display', () => {
    const out = describeRamp(RAMP, { gradeDeg: 17.6, climbable: true, maxDeg: 20 });
    expect(out.sub).toContain('18°');
    expect(out.sub).not.toContain('17.6');
  });

  it('leaves the title alone', () => {
    expect(describeRamp(RAMP, { gradeDeg: 30, climbable: false, maxDeg: 20 }).title).toBe(describeRamp(RAMP).title);
  });

  it('ships the grade and climbable lines in both locales, and no tier lines', () => {
    for (const locale of ['en', 'fr'] as const) {
      const keys = localeKeys(locale);
      expect(keys['shell.selection.ramp_grade'], `${locale} ramp_grade`).toBeTypeOf('string');
      for (const key of ['shell.selection.ramp_climbable', 'shell.selection.ramp_not_climbable']) {
        expect(keys[key], `${locale} ${key}`).toBeTypeOf('string');
        expect(keys[key]).toContain('{max}');
      }
      for (const key of ['shell.selection.ramp_tiers', 'shell.selection.ramp_tiers_all', 'shell.selection.ramp_tiers_none']) {
        expect(keys[key], `${locale} ${key}`).toBeUndefined();
      }
    }
  });

  it('ships the ramp-too-steep order sentence in both locales with id, grade, role and max but no tier', () => {
    for (const locale of ['en', 'fr'] as const) {
      const text = localeKeys(locale)['order.blocked.ramp_too_steep'];
      expect(text, `${locale} order.blocked.ramp_too_steep`).toBeTypeOf('string');
      for (const param of ['id', 'grade', 'max']) expect(text).toContain(`{${param}}`);
      expect(text).not.toContain('{tier}');
    }
  });
});
