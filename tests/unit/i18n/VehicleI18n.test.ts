// BlastSimulator2026 — CH2.4: i18n key resolution tests for vehicle tier names
//
// Verifies that every nameKey referenced by the vehicle catalog resolves
// (i.e. returns a non-empty string that is not the key itself) in both
// 'en' and 'fr' locales, and that translations differ between locales.

import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import { getAllVehicleRoles, getVehicleDefByTier } from '../../../src/core/entities/Vehicle.js';
import type { VehicleRole } from '../../../src/core/entities/Vehicle.js';

const ALL_ROLES: VehicleRole[] = getAllVehicleRoles();
const ALL_TIERS = [1, 2, 3] as const;
const LOCALES = ['en', 'fr'] as const;

beforeEach(() => {
  setLocale('en');
});

// ── All 15 nameKeys resolve in each locale ───────────────────────────────────

describe('vehicle tier nameKeys from VEHICLE_DEFS resolve in both locales', () => {
  for (const locale of LOCALES) {
    it(`locale ${locale}: every VEHICLE_DEFS nameKey resolves to a non-empty string`, () => {
      setLocale(locale);
      for (const role of ALL_ROLES) {
        for (const tier of ALL_TIERS) {
          const key = getVehicleDefByTier(role, tier).nameKey;
          const result = t(key);
          expect(result, `key "${key}" must resolve in ${locale}`).not.toBe(key);
          expect(result.length).toBeGreaterThan(0);
        }
      }
    });
  }
});

// ── nameKey format: vehicle.<role>.tier<N> ───────────────────────────────────

describe('vehicle tier nameKeys follow the expected pattern', () => {
  it('every nameKey starts with "vehicle."', () => {
    for (const role of ALL_ROLES) {
      for (const tier of ALL_TIERS) {
        const key = getVehicleDefByTier(role, tier).nameKey;
        expect(key, `nameKey for ${role} tier ${tier}`).toMatch(/^vehicle\./);
      }
    }
  });

  it('every nameKey ends with ".tier1", ".tier2", or ".tier3"', () => {
    for (const role of ALL_ROLES) {
      for (const tier of ALL_TIERS) {
        const key = getVehicleDefByTier(role, tier).nameKey;
        expect(key, `nameKey for ${role} tier ${tier}`).toMatch(/\.tier[123]$/);
      }
    }
  });
});

// ── Spot-check specific spec-defined names ───────────────────────────────────

describe('vehicle tier names match spec-defined humorous names (en)', () => {
  beforeEach(() => setLocale('en'));

  it('building_destroyer tier 1 is "Wrecking Rascal"', () => {
    expect(t('vehicle.building_destroyer.tier1')).toBe('Wrecking Rascal');
  });

  it('building_destroyer tier 2 is "Demolition Darling"', () => {
    expect(t('vehicle.building_destroyer.tier2')).toBe('Demolition Darling');
  });

  it('building_destroyer tier 3 is "Obliterator Supreme"', () => {
    expect(t('vehicle.building_destroyer.tier3')).toBe('Obliterator Supreme');
  });

  it('debris_hauler tier 1 is "Dumpster on Wheels"', () => {
    expect(t('vehicle.debris_hauler.tier1')).toBe('Dumpster on Wheels');
  });

  it('debris_hauler tier 2 is "Haul-o-Matic 3000"', () => {
    expect(t('vehicle.debris_hauler.tier2')).toBe('Haul-o-Matic 3000');
  });

  it('debris_hauler tier 3 is "Mega Mover XL"', () => {
    expect(t('vehicle.debris_hauler.tier3')).toBe('Mega Mover XL');
  });

  it('drill_rig tier 1 is "Pokey McPoke"', () => {
    expect(t('vehicle.drill_rig.tier1')).toBe('Pokey McPoke');
  });

  it('drill_rig tier 2 is "Bore Master"', () => {
    expect(t('vehicle.drill_rig.tier2')).toBe('Bore Master');
  });

  it('drill_rig tier 3 is "Helldriller"', () => {
    expect(t('vehicle.drill_rig.tier3')).toBe('Helldriller');
  });

  it('rock_digger tier 1 is "The Scratch"', () => {
    expect(t('vehicle.rock_digger.tier1')).toBe('The Scratch');
  });

  it('rock_digger tier 2 is "Scoop Sergeant"', () => {
    expect(t('vehicle.rock_digger.tier2')).toBe('Scoop Sergeant');
  });

  it('rock_digger tier 3 is "Voxel Vanquisher"', () => {
    expect(t('vehicle.rock_digger.tier3')).toBe('Voxel Vanquisher');
  });

  it('rock_fragmenter tier 1 is "Cracky"', () => {
    expect(t('vehicle.rock_fragmenter.tier1')).toBe('Cracky');
  });

  it('rock_fragmenter tier 2 is "Smasher 2000"', () => {
    expect(t('vehicle.rock_fragmenter.tier2')).toBe('Smasher 2000');
  });

  it('rock_fragmenter tier 3 is "The Atomizer"', () => {
    expect(t('vehicle.rock_fragmenter.tier3')).toBe('The Atomizer');
  });
});

// ── en/fr parity — translations differ between locales ───────────────────────

describe('vehicle tier names resolve differently in en vs fr', () => {
  it('building_destroyer tier 1 differs between en and fr', () => {
    setLocale('en');
    const en = t('vehicle.building_destroyer.tier1');
    setLocale('fr');
    const fr = t('vehicle.building_destroyer.tier1');
    expect(en).not.toBe('vehicle.building_destroyer.tier1');
    expect(fr).not.toBe('vehicle.building_destroyer.tier1');
    expect(en).not.toBe(fr);
  });

  it('debris_hauler tier 2 differs between en and fr', () => {
    setLocale('en');
    const en = t('vehicle.debris_hauler.tier2');
    setLocale('fr');
    const fr = t('vehicle.debris_hauler.tier2');
    expect(en).not.toBe(fr);
  });

  it('rock_fragmenter tier 3 differs between en and fr', () => {
    setLocale('en');
    const en = t('vehicle.rock_fragmenter.tier3');
    setLocale('fr');
    const fr = t('vehicle.rock_fragmenter.tier3');
    expect(en).not.toBe(fr);
  });
});
