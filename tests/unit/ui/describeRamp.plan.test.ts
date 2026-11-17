// BlastSimulator2026 — Unit tests: ramp plan readout and the single climbable line (#1942, #2045)

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as describeRampModule from '../../../src/ui/describeRamp.js';
import { describeRampPlan } from '../../../src/ui/describeRamp.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { getAllVehicleRoles, type VehicleRole } from '../../../src/core/entities/Vehicle.js';

const KEYS = ['ui.build.ramp_readout', 'ui.build.ramp_climbable', 'ui.build.ramp_not_climbable', 'ui.build.ramp_roles', 'ui.build.ramp_roles_none'];
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

describe('describeRampPlan: the roles line (#2288 C6)', () => {
  beforeEach(() => setLocale('en'));
  const plan = { length: 22, legs: 2, cost: 2200, gradeDeg: 14, climb: { gradeDeg: 14, climbable: true, maxDeg: 20 } };
  const work: VehicleRole[] = getAllVehicleRoles().filter(r => r !== 'travel_vehicle');
  const name = (r: VehicleRole): string => t(`vehicle_type.${r}`);

  it('without roles the output is unchanged', () => {
    expect(describeRampPlan(plan)).toHaveLength(2);
  });

  it('with roles appends exactly one line after the others', () => {
    const base = describeRampPlan(plan);
    const lines = describeRampPlan({ ...plan, roles: work });
    expect(lines).toHaveLength(base.length + 1);
    expect(lines.slice(0, base.length)).toEqual(base);
  });

  it('the roles line names each given role by its localized name', () => {
    const line = describeRampPlan({ ...plan, roles: work }).at(-1)!;
    for (const r of work) expect(line).toContain(name(r));
    expect(line).not.toContain(name('travel_vehicle'));
    expect(line).not.toMatch(/vehicle\.role_name|ui\.build\./);
  });

  it('the roles line carries the roles key text', () => {
    const roles: VehicleRole[] = ['drill_rig', 'debris_hauler'];
    const line = describeRampPlan({ ...plan, roles }).at(-1)!;
    const prefix = locale('en')['ui.build.ramp_roles']!.split('{roles}')[0]!.trim();
    expect(line).toContain(prefix);
    expect(line).toContain(name('drill_rig'));
    expect(line).toContain(name('debris_hauler'));
    expect(line).not.toContain(name('rock_digger'));
  });

  it('a single role is named alone', () => {
    const line = describeRampPlan({ ...plan, roles: ['travel_vehicle'] }).at(-1)!;
    expect(line).toContain(name('travel_vehicle'));
    expect(line).not.toContain(name('drill_rig'));
  });

  it('an empty role list says no role can climb it', () => {
    const lines = describeRampPlan({ ...plan, roles: [] });
    expect(lines.at(-1)).toBe(t('ui.build.ramp_roles_none'));
    expect(lines).toHaveLength(describeRampPlan(plan).length + 1);
  });

  it('works with no climb line too', () => {
    const lines = describeRampPlan({ ...plan, climb: null, roles: ['drill_rig'] });
    expect(lines).toHaveLength(2);
    expect(lines.at(-1)).toContain(name('drill_rig'));
  });

  it('speaks French after a locale switch', () => {
    const en = describeRampPlan({ ...plan, roles: work });
    setLocale('fr');
    const fr = describeRampPlan({ ...plan, roles: work });
    expect(fr.at(-1)).not.toEqual(en.at(-1));
    expect(fr.at(-1)).toContain(t('vehicle_type.drill_rig'));
    setLocale('en');
  });
});

describe('vehicle role name i18n keys (#2288)', () => {
  it.each(getAllVehicleRoles())('vehicle_type.%s exists in en and fr and differs between them', (role) => {
    const key = `vehicle_type.${role}`;
    expect(locale('en')[key], `en ${key}`).toBeTruthy();
    expect(locale('fr')[key], `fr ${key}`).toBeTruthy();
    expect(locale('fr')[key]).not.toBe(locale('en')[key]);
  });

  it('the roles line takes the {roles} list', () => {
    expect(locale('en')['ui.build.ramp_roles']).toContain('{roles}');
    expect(locale('fr')['ui.build.ramp_roles']).toContain('{roles}');
  });
});
