// BlastSimulator2026 — Unit tests: ramp plan readout and the single climbable line (#1942, #2045)

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as describeRampModule from '../../../src/ui/describeRamp.js';
import { describeRampPlan } from '../../../src/ui/describeRamp.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';

const KEYS = ['ui.build.ramp_readout', 'ui.build.ramp_climbable', 'ui.build.ramp_not_climbable'];
const REMOVED = ['ui.build.ramp_tiers_check', 'ui.build.ramp_tiers_max'];
const locale = (l: 'en' | 'fr'): Record<string, string> =>
  JSON.parse(readFileSync(join(__dirname, `../../../src/core/i18n/locales/${l}.json`), 'utf8'));

describe('describeRampPlan', () => {
  beforeEach(() => setLocale('en'));
  const plan = { length: 22, legs: 2, cost: 2200, gradeDeg: 20, climb: null };
  const climbable = { gradeDeg: 18, climbable: true, maxDeg: 20 };
  const steep = { gradeDeg: 26, climbable: false, maxDeg: 20 };

  it('returns the length, legs, cost and grade in its lines', () => {
    const text = describeRampPlan(plan).join('\n');
    expect(text).toContain('22');
    expect(text).toContain('2,200');
    expect(text).toContain('20');
    expect(text).not.toMatch(/ui\.build\./);
  });

  it('without climb info (non-progression site) has one line and no climbable text', () => {
    expect(describeRampPlan(plan)).toHaveLength(1);
    expect(describeRampPlan(plan).join('\n')).not.toContain('T1');
  });

  it('with a climbable ramp adds exactly one line, naming the limit', () => {
    const lines = describeRampPlan({ ...plan, climb: climbable });
    expect(lines).toHaveLength(2);
    expect(lines).toContain(t('ui.build.ramp_climbable', { max: 20 }));
    expect(lines.at(-1)).toContain('20');
  });

  it('with a steep ramp the line says vehicles cannot climb it, naming the limit', () => {
    const lines = describeRampPlan({ ...plan, climb: steep });
    expect(lines).toHaveLength(2);
    expect(lines).toContain(t('ui.build.ramp_not_climbable', { max: 20 }));
    expect(lines.at(-1)).toContain('20');
  });

  it('climbable and not-climbable read differently', () => {
    expect(describeRampPlan({ ...plan, climb: climbable }).at(-1)).not.toBe(describeRampPlan({ ...plan, climb: steep }).at(-1));
  });

  it('no tier wording anywhere in the readout', () => {
    for (const climb of [climbable, steep]) expect(describeRampPlan({ ...plan, climb }).join('\n')).not.toMatch(/\bT[123]\b|tier/i);
  });

  it('changes with the plan figures', () => {
    expect(describeRampPlan({ ...plan, cost: 9900 })).not.toEqual(describeRampPlan(plan));
  });

  it('speaks French after a locale switch', () => {
    const en = describeRampPlan({ ...plan, climb: steep });
    setLocale('fr');
    expect(describeRampPlan({ ...plan, climb: steep })).not.toEqual(en);
    setLocale('en');
  });

  it('the tier check helper is gone', () => {
    expect((describeRampModule as Record<string, unknown>)['rampTierCheckLine']).toBeUndefined();
  });
});

describe('ramp readout i18n keys', () => {
  it.each(KEYS)('%s exists in en and fr and differs between them', (key) => {
    const en = locale('en'); const fr = locale('fr');
    expect(en[key], `en ${key}`).toBeTruthy();
    expect(fr[key], `fr ${key}`).toBeTruthy();
    expect(fr[key]).not.toBe(en[key]);
  });

  it.each(['ui.build.ramp_climbable', 'ui.build.ramp_not_climbable'])('%s takes the {max} limit', (key) => {
    expect(locale('en')[key]).toContain('{max}');
    expect(locale('fr')[key]).toContain('{max}');
  });

  it.each(REMOVED)('%s is removed from both locales', (key) => {
    expect(locale('en')[key]).toBeUndefined();
    expect(locale('fr')[key]).toBeUndefined();
  });
});
