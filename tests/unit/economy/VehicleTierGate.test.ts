// BlastSimulator2026 — grade-gated vehicle tiers on progression sites (#1928)

import { describe, it, expect, beforeAll } from 'vitest';
import {
  requiredGradeForVehicleTier,
  vehicleTierGate,
  vehicleTierRefusalText,
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

  it('balance table unlocks tiers at grades 0 / 2 / 4', () => {
    expect(VEHICLE_TIER_UNLOCK_GRADE).toEqual({ 1: 0, 2: 2, 3: 4 });
  });

  it.each([[1, 0], [2, 2], [3, 4]] as const)('tier %i needs grade %i', (tier, grade) => {
    expect(requiredGradeForVehicleTier(tier)).toBe(grade);
  });

  it('a non-progression site (grade undefined) is never gated', () => {
    for (const tier of TIERS) expect(vehicleTierGate(undefined, tier)).toBeNull();
  });

  it('tier 1 is open at grade 0', () => {
    expect(vehicleTierGate(0, 1)).toBeNull();
  });

  it('tier 2 is gated below grade 2 and names the grade needed', () => {
    expect(vehicleTierGate(0, 2)).toEqual({ needed: 2 });
    expect(vehicleTierGate(1, 2)).toEqual({ needed: 2 });
    expect(vehicleTierGate(2, 2)).toBeNull();
  });

  it('tier 3 is gated below grade 4', () => {
    expect(vehicleTierGate(3, 3)).toEqual({ needed: 4 });
    expect(vehicleTierGate(2, 3)).toEqual({ needed: 4 });
    expect(vehicleTierGate(4, 3)).toBeNull();
    expect(vehicleTierGate(9, 3)).toBeNull();
  });

  it('refusal text names the current and the needed grade', () => {
    const text = vehicleTierRefusalText(1, 2);
    expect(text).toBe('The dealer laughs at your Hobby Quarry Licence. Come back with a Licensed Quarry.');
  });

  it('lock label reads "Needs <grade name>"', () => {
    expect(vehicleTierLockLabel(2)).toBe('Needs Licensed Quarry');
    expect(vehicleTierLockLabel(4)).toBe('Needs Strategic National Excavation');
  });

  it('registers unlock lines on grades 2 and 4 only', () => {
    expect(unlockLinesFor(2).map(l => l.key)).toContain('progression.unlock.vehicle_tier.2');
    expect(unlockLinesFor(4).map(l => l.key)).toContain('progression.unlock.vehicle_tier.4');
    for (const g of [1, 3, 5]) {
      expect(unlockLinesFor(g).map(l => l.key)).not.toContain(`progression.unlock.vehicle_tier.${g}`);
    }
  });

  it('every new key has real text in en and fr', () => {
    const keys = ['progression.unlock.vehicle_tier.2', 'progression.unlock.vehicle_tier.4', 'vehicle.tier_locked', 'ui.fleet.tier_locked'];
    const e = en as Record<string, string>;
    const f = fr as Record<string, string>;
    for (const k of keys) {
      expect(e[k], `en ${k}`).toBeTruthy();
      expect(f[k], `fr ${k}`).toBeTruthy();
      expect(f[k], `fr differs ${k}`).not.toBe(e[k]);
    }
    expect(e['vehicle.tier_locked']).toBe('The dealer laughs at your {current}. Come back with a {needed}.');
    expect(e['ui.fleet.tier_locked']).toBe('Needs {grade}');
    expect(t('progression.unlock.vehicle_tier.2')).not.toBe('progression.unlock.vehicle_tier.2');
  });
});
