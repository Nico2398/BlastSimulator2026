// Issue #1377 — dealership and Build catalog cards: one inline line
// "<purpose> · $N/h" plus a tooltip carrying the absolute stats.
import { describe, it, expect, afterEach } from 'vitest';
import {
  BUILDING_CAPACITY_UNIT_KEY,
  buildingCardLine,
  buildingCardTooltip,
  formatPerHour,
  vehicleCardLine,
  vehicleCardTooltip,
} from '../../../src/ui/catalogCardText.js';
import {
  getAllVehicleRoles, getVehicleDefByTier, type VehicleRole, type VehicleTier,
} from '../../../src/core/entities/Vehicle.js';
import {
  getAllBuildingTypes, getBuildingDef, getFootprintSize, type BuildingTier,
} from '../../../src/core/entities/Building.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

const EN = enLocale as Record<string, string>;
const FR = frLocale as Record<string, string>;
const TIERS: VehicleTier[] = [1, 2, 3];
const BUILDING_TIERS: BuildingTier[] = [1, 2, 3];
const SEP = ' · ';
const VEHICLE_CAPACITY_UNIT: Partial<Record<VehicleRole, string>> = {
  rock_digger: 'ui.fleet.unit.m3_per_hour',
  drill_rig: 'ui.fleet.unit.holes_per_hour',
  building_destroyer: 'ui.fleet.unit.kg_per_hour',
  rock_fragmenter: 'ui.fleet.unit.kg_per_hour',
};

/** Static prefix of a locale template, before its first placeholder. */
function labelOf(key: string): string {
  return (EN[key] ?? '').split('{')[0]!.trim();
}

afterEach(() => setLocale('en'));

describe('formatPerHour', () => {
  it('renders whole dollars per hour in English', () => {
    expect(formatPerHour(12.4)).toBe('$12/h');
    expect(formatPerHour(12.5)).toBe('$13/h');
    expect(formatPerHour(240)).toBe('$240/h');
  });

  it('boundary: zero and sub-dollar costs round to $0/h', () => {
    expect(formatPerHour(0)).toBe('$0/h');
    expect(formatPerHour(0.4)).toBe('$0/h');
  });

  it('renders through the French locale, not the English template', () => {
    setLocale('fr');
    const out = formatPerHour(12.4);
    expect(out).toBe('12\u00a0$/h');
    expect(out).not.toBe('$12/h');
    expect(out).not.toContain('ui.card.per_hour');
  });
});

describe('vehicleCardLine', () => {
  for (const role of getAllVehicleRoles()) {
    for (const tier of TIERS) {
      it(`${role} tier ${tier}: "<desc> · $N/h" with no multiplier text`, () => {
        const def = getVehicleDefByTier(role, tier);
        const perHour = Math.round(def.maintenanceCostPerTick + def.fuelCostPerTick);
        const line = vehicleCardLine(def);
        expect(line).toBe(`${t(`vehicle.${role}.desc`)}${SEP}$${perHour}/h`);
        expect(line).not.toContain('×');
        expect(line).not.toContain('1.0');
      });
    }
  }

  it('French line uses the French description', () => {
    setLocale('fr');
    const def = getVehicleDefByTier('debris_hauler', 1);
    const line = vehicleCardLine(def);
    expect(line.startsWith(FR['vehicle.debris_hauler.desc']!)).toBe(true);
    expect(line).not.toContain(EN['vehicle.debris_hauler.desc']!);
  });
});

describe('vehicleCardTooltip', () => {
  for (const role of getAllVehicleRoles()) {
    for (const tier of TIERS) {
      it(`${role} tier ${tier}: absolute speed, capacity, work rate, licence level`, () => {
        const def = getVehicleDefByTier(role, tier);
        const tip = vehicleCardTooltip(def);
        const fixed = (n: number): string => { const r = Number(n.toFixed(2)); return Number.isInteger(r) ? formatMoney(r) : String(r); };
        const capacity = VEHICLE_CAPACITY_UNIT[role]
          ? t('ui.fleet.tip.capacity_work', { value: fixed(def.capacity), unit: t(VEHICLE_CAPACITY_UNIT[role]!) })
          : t('ui.fleet.tip.capacity_kg', { value: fixed(def.capacity) });
        expect(tip.split('\n')).toEqual([
          t('ui.fleet.tip.speed', { value: fixed(def.speed) }),
          capacity,
          t('ui.fleet.tip.work_rate', { value: fixed(def.workRate) }),
          t('ui.fleet.tip.licence', { tier }),
        ]);
        expect(tip).toContain(labelOf('ui.fleet.tip.licence'));
        expect(tip).not.toContain('×');
        expect(tip).not.toMatch(/ui\.fleet\.tip/);
      });
    }
  }

  it('hauler capacity is a kg payload; destroyer and fragmenter are kg/h throughput', () => {
    expect(vehicleCardTooltip(getVehicleDefByTier('debris_hauler', 1))).toContain('Capacity: 200 kg');
    for (const role of ['rock_fragmenter', 'building_destroyer'] as const) {
      expect(vehicleCardTooltip(getVehicleDefByTier(role, 1))).toMatch(/Capacity: [\d,.]+ kg\/h/);
    }
  });

  it('drill rig capacity is not stated in kg', () => {
    for (const tier of TIERS) {
      expect(vehicleCardTooltip(getVehicleDefByTier('drill_rig', tier))).not.toMatch(/kg/i);
    }
  });

  it('is translated: French tooltip differs from English', () => {
    const def = getVehicleDefByTier('rock_digger', 2);
    const en = vehicleCardTooltip(def);
    setLocale('fr');
    expect(vehicleCardTooltip(def)).not.toBe(en);
  });
});

describe('buildingCardLine', () => {
  for (const type of getAllBuildingTypes()) {
    for (const tier of BUILDING_TIERS) {
      it(`${type} tier ${tier}: "<desc> · $N/h"`, () => {
        const def = getBuildingDef(type, tier);
        const line = buildingCardLine(def);
        expect(line).toBe(`${t(`building.${type}.desc`)}${SEP}$${Math.round(def.operatingCostPerTick)}/h`);
        expect(line).not.toContain('building.');
      });
    }
  }
});

describe('buildingCardTooltip', () => {
  it('maps every building type to a ui.build.unit.* key that resolves in en and fr', () => {
    for (const type of getAllBuildingTypes()) {
      const key = BUILDING_CAPACITY_UNIT_KEY[type];
      if (key === null) continue;
      expect(key, type).toMatch(/^ui\.build\.unit\./);
      expect(EN[key], key).toBeTruthy();
      expect(FR[key], key).toBeTruthy();
    }
  });

  for (const type of getAllBuildingTypes()) {
    for (const tier of BUILDING_TIERS) {
      it(`${type} tier ${tier}: footprint W×H, capacity with unit (when enforced), upkeep $/h`, () => {
        const def = getBuildingDef(type, tier);
        const { sizeX, sizeZ } = getFootprintSize(def.footprint);
        const unitKey = BUILDING_CAPACITY_UNIT_KEY[type];
        expect(buildingCardTooltip(def).split('\n')).toEqual([
          t('ui.build.tip.footprint', { w: sizeX, h: sizeZ }),
          ...(unitKey ? [t('ui.build.tip.capacity', { value: formatMoney(def.capacity), unit: t(unitKey) })] : []),
          t('ui.build.tip.upkeep', { cost: formatPerHour(def.operatingCostPerTick) }),
        ]);
        const tip = buildingCardTooltip(def);
        expect(tip).not.toMatch(/ui\.build\.tip/);
      });
    }
  }

  it('research center has no capacity line', () => {
    expect(buildingCardTooltip(getBuildingDef('research_center', 1))).not.toContain('Capacity');
  });

  it('storage buildings state capacity in kg', () => {
    for (const type of ['explosive_warehouse', 'freight_warehouse'] as const) {
      expect(buildingCardTooltip(getBuildingDef(type, 1))).toContain('kg');
    }
  });

  it('French tooltip differs from English', () => {
    const def = getBuildingDef('living_quarters', 2);
    const en = buildingCardTooltip(def);
    setLocale('fr');
    expect(buildingCardTooltip(def)).not.toBe(en);
  });
});

describe('locale keys for catalog cards', () => {
  const keys: string[] = [
    'ui.card.per_hour',
    ...getAllVehicleRoles().map(r => `vehicle.${r}.desc`),
    ...getAllBuildingTypes().map(b => `building.${b}.desc`),
    'ui.fleet.tip.speed', 'ui.fleet.tip.capacity_kg', 'ui.fleet.tip.capacity_work',
    'ui.fleet.tip.work_rate', 'ui.fleet.tip.licence',
    'ui.build.tip.footprint', 'ui.build.tip.capacity', 'ui.build.tip.upkeep',
    'ui.build.unit.beds', 'ui.build.unit.seats',
    'ui.build.unit.vehicles',
  ];
  // Locale-neutral formats (unit symbols, separator): identical in en and fr by design.
  const NEUTRAL = ['ui.card.line', 'ui.build.unit.kg', 'ui.fleet.unit.m3_per_hour', 'ui.fleet.unit.kg_per_hour'];
  for (const key of NEUTRAL) {
    it(`${key} exists in en and fr`, () => {
      expect(EN[key], `en ${key}`).toBeTruthy();
      expect(FR[key], `fr ${key}`).toBeTruthy();
    });
  }

  for (const key of keys) {
    it(`${key} exists in en and fr, and fr differs from en`, () => {
      expect(EN[key], `en ${key}`).toBeTruthy();
      expect(FR[key], `fr ${key}`).toBeTruthy();
      expect(FR[key]).not.toBe(EN[key]);
    });
  }
});
