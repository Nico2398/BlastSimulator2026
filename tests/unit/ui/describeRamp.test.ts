// BlastSimulator2026 — Unit tests: ramp title/subline incl. grade and climbable tiers (#1938)

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeRamp } from '../../../src/ui/describeRamp.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
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
    const withGrade = describeRamp(RAMP, { gradeDeg: 30, tiers: [1], progression: true });
    expect(withGrade.sub).not.toBe(plain.sub);
    expect(withGrade.sub).toContain('30°');
  });

  it('names a different climbable set for a gentle ramp than for a steep one', () => {
    const steep = describeRamp(RAMP, { gradeDeg: 30, tiers: [1], progression: true });
    const gentle = describeRamp(RAMP, { gradeDeg: 15, tiers: [1, 2, 3], progression: true });
    expect(gentle.sub).not.toBe(steep.sub);
    expect(gentle.sub).toContain('15°');
  });

  it('rounds a fractional grade for display', () => {
    const out = describeRamp(RAMP, { gradeDeg: 17.6, tiers: [1, 2, 3], progression: true });
    expect(out.sub).toContain('18°');
    expect(out.sub).not.toContain('17.6');
  });

  it('leaves the title alone', () => {
    expect(describeRamp(RAMP, { gradeDeg: 30, tiers: [1], progression: true }).title).toBe(describeRamp(RAMP).title);
  });

  it('ships the grade and tier lines in both locales', () => {
    for (const locale of ['en', 'fr'] as const) {
      const keys = localeKeys(locale);
      expect(keys['shell.selection.ramp_grade'], `${locale} ramp_grade`).toBeTypeOf('string');
      expect(keys['shell.selection.ramp_tiers'], `${locale} ramp_tiers`).toBeTypeOf('string');
    }
  });

  it('ships the ramp-too-steep order sentence in both locales with every parameter', () => {
    for (const locale of ['en', 'fr'] as const) {
      const text = localeKeys(locale)['order.blocked.ramp_too_steep'];
      expect(text, `${locale} order.blocked.ramp_too_steep`).toBeTypeOf('string');
      for (const param of ['id', 'grade', 'tier', 'role', 'max']) expect(text).toContain(`{${param}}`);
    }
  });
});
