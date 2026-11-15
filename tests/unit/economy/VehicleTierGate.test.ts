// BlastSimulator2026 — grade-gated vehicle tiers on progression sites (#1928)

import { describe, it, expect, beforeAll } from 'vitest';
import {
  vehicleTierGate,
  vehicleTierRefusal,
  vehicleTierLockLabel,
} from '../../../src/core/economy/VehicleTierGate.js';
import { unlockLinesFor } from '../../../src/core/economy/MineGrade.js';
import { VEHICLE_TIER_UNLOCK_GRADE } from '../../../src/core/config/balance.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';
import type { VehicleTier } from '../../../src/core/entities/Vehicle.js';

const TIERS: VehicleTier[] = [1, 2, 3];

describe('VehicleTierGate (#1928)', () => {
  beforeAll(() => setLocale('en'));

  it('balance table unlocks tiers at grades 0 / 1 / 2 (#2277)', () => {
    expect(VEHICLE_TIER_UNLOCK_GRADE).toEqual({ 1: 0, 2: 1, 3: 2 });
  });

  it.each([[1, 0], [2, 1], [3, 2]] as const)('tier %i needs grade %i', (tier, grade) => {
    expect(vehicleTierGate(-1, tier)).toEqual({ needed: grade });
  });

  it('a non-progression site (grade undefined) is never gated', () => {
    for (const tier of TIERS) expect(vehicleTierGate(undefined, tier)).toBeNull();
  });

  it('tier 1 is open at grade 0', () => {
    expect(vehicleTierGate(0, 1)).toBeNull();
  });

  it('tier 2 is gated at grade 0 and names grade 1', () => {
    expect(vehicleTierGate(0, 2)).toEqual({ needed: 1 });
    expect(vehicleTierGate(1, 2)).toBeNull();
    expect(vehicleTierGate(2, 2)).toBeNull();
  });

  it('tier 3 is gated below grade 2', () => {
    expect(vehicleTierGate(0, 3)).toEqual({ needed: 2 });
    expect(vehicleTierGate(1, 3)).toEqual({ needed: 2 });
    expect(vehicleTierGate(2, 3)).toBeNull();
    expect(vehicleTierGate(3, 3)).toBeNull();
    expect(vehicleTierGate(9, 3)).toBeNull();
  });

  it('refusal text names the current and the needed grade', () => {
    setLocale('en');
    expect(vehicleTierRefusal(0, 2)).toBe('The dealer laughs at your Surface. Come back with a Depth.');
    expect(vehicleTierRefusal(1, 3)).toBe('The dealer laughs at your Depth. Come back with a Distance.');
  });

  it('lock label reads "Needs <grade name>"', () => {
    expect(vehicleTierLockLabel(1)).toBe('Needs Depth');
    expect(vehicleTierLockLabel(2)).toBe('Needs Distance');
  });

  it('registers unlock lines on the grades that open a vehicle tier, and on no other', () => {
    expect(unlockLinesFor(1).map(l => l.key)).toContain('progression.unlock.vehicle_tier.1');
    expect(unlockLinesFor(2).map(l => l.key)).toContain('progression.unlock.vehicle_tier.2');
    for (const g of [3, 4]) {
      expect(unlockLinesFor(g).map(l => l.key).filter(k => k.includes('vehicle_tier'))).toEqual([]);
    }
    expect(unlockLinesFor(1).map(l => l.key)).not.toContain('progression.unlock.vehicle_tier.2');
  });

  it('every new key has real text in en and fr', () => {
    const keys = ['progression.unlock.vehicle_tier.1', 'progression.unlock.vehicle_tier.2', 'vehicle.tier_locked', 'ui.fleet.tier_locked'];
    const e = en as Record<string, string>;
    const f = fr as Record<string, string>;
    for (const k of keys) {
      expect(e[k], `en ${k}`).toBeTruthy();
      expect(f[k], `fr ${k}`).toBeTruthy();
      expect(f[k], `fr differs ${k}`).not.toBe(e[k]);
    }
    expect(e['vehicle.tier_locked']).toBe('The dealer laughs at your {current}. Come back with a {needed}.');
    expect(e['ui.fleet.tier_locked']).toBe('Needs {grade}');
    expect(t('progression.unlock.vehicle_tier.1')).not.toBe('progression.unlock.vehicle_tier.1');
    expect(t('progression.unlock.vehicle_tier.2')).not.toBe('progression.unlock.vehicle_tier.2');
  });
});
