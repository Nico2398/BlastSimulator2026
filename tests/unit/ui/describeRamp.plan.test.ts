// BlastSimulator2026 — Unit tests: ramp plan readout and tier check line (#1942)

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeRampPlan, rampTierCheckLine } from '../../../src/ui/describeRamp.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';

const KEYS = ['ui.build.ramp_readout', 'ui.build.ramp_tiers_check', 'ui.build.ramp_tiers_max'];
const locale = (l: 'en' | 'fr'): Record<string, string> =>
  JSON.parse(readFileSync(join(__dirname, `../../../src/core/i18n/locales/${l}.json`), 'utf8'));

describe('rampTierCheckLine', () => {
  beforeEach(() => setLocale('en'));

  it('marks the tiers that climb and names the limit of the first that cannot', () => {
    expect(rampTierCheckLine([1, 2])).toBe('T1 ✓ T2 ✓ T3 ✗ (max 18°)');
  });

  it('a ramp only tier 1 climbs names tier 2 limit', () => {
    expect(rampTierCheckLine([1])).toBe('T1 ✓ T2 ✗ T3 ✗ (max 24°)');
  });

  it('omits the max when every tier climbs', () => {
    expect(rampTierCheckLine([1, 2, 3])).toBe('T1 ✓ T2 ✓ T3 ✓');
  });

  it('a ramp no tier climbs names the lowest tier limit', () => {
    expect(rampTierCheckLine([])).toBe('T1 ✗ T2 ✗ T3 ✗ (max 30°)');
  });
});

describe('describeRampPlan', () => {
  beforeEach(() => setLocale('en'));
  const plan = { length: 22, legs: 2, cost: 2200, gradeDeg: 20, tiers: null };

  it('returns the length, legs, cost and grade in its lines', () => {
    const text = describeRampPlan(plan).join('\n');
    expect(text).toContain('22');
    expect(text).toContain('2');
    expect(text).toContain('2,200');
    expect(text).toContain('20');
    expect(text).not.toMatch(/ui\.build\./);
  });

  it('without tiers (non-progression site) has no tier line', () => {
    expect(describeRampPlan(plan).join('\n')).not.toContain('T1');
  });

  it('with tiers adds exactly one more line holding the tier check', () => {
    const withTiers = describeRampPlan({ ...plan, tiers: [1, 2] });
    expect(withTiers).toHaveLength(describeRampPlan(plan).length + 1);
    expect(withTiers).toContain(rampTierCheckLine([1, 2]));
  });

  it('an empty tier list still adds the line (nothing climbs)', () => {
    expect(describeRampPlan({ ...plan, tiers: [] })).toContain(rampTierCheckLine([]));
  });

  it('changes with the plan figures', () => {
    expect(describeRampPlan({ ...plan, cost: 9900 })).not.toEqual(describeRampPlan(plan));
  });

  it('speaks French after a locale switch', () => {
    const en = describeRampPlan(plan);
    setLocale('fr');
    expect(describeRampPlan(plan)).not.toEqual(en);
    setLocale('en');
  });
});

describe('ramp readout i18n keys', () => {
  it.each(KEYS)('%s exists in en and fr and differs between them', (key) => {
    const en = locale('en'); const fr = locale('fr');
    expect(en[key], `en ${key}`).toBeTruthy();
    expect(fr[key], `fr ${key}`).toBeTruthy();
    expect(fr[key]).not.toBe(en[key]);
  });
});
