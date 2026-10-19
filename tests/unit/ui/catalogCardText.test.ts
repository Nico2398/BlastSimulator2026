// Issue #1377 — dealership and Build catalog cards: one inline line
// "<purpose> · $N/h" plus a tooltip carrying the absolute stats.
import { describe, it, expect, afterEach } from 'vitest';
import {
  BUILDING_CAPACITY_UNIT_KEY,
  buildingCardLine,
  buildingCardTooltip,
  buildingCardEffects,
  buildingScoreEffectLines,
  formatPerHour,
  vehicleCardLine,
  vehicleCardTooltip,
  vehicleCapacityText,
} from '../../../src/ui/catalogCardText.js';
import {
  getAllVehicleRoles, getVehicleDefByTier, type VehicleRole, type VehicleTier,
} from '../../../src/core/entities/Vehicle.js';
import {
  getAllBuildingTypes, getBuildingDef, getFootprintSize, type BuildingTier,
} from '../../../src/core/entities/Building.js';
import { DRILL_RIG_MAX_DEPTH_M } from '../../../src/core/config/balance.js';
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
        const base = `${t(`vehicle.${role}.desc`)}${SEP}$${perHour}/h`;
        expect(line).toBe(role === 'drill_rig' ? `${base}${SEP}${t('ui.fleet.card.reach', { value: DRILL_RIG_MAX_DEPTH_M[tier] })}` : base);
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

describe('vehicleCardLine drill rig reach (#1679)', () => {
  it('drill rig card states 12 / 24 / 40 m reach; other roles omit it', () => {
    const expected = { 1: 12, 2: 24, 3: 40 } as const;
    for (const tier of TIERS) {
      expect(vehicleCardLine(getVehicleDefByTier('drill_rig', tier)))
        .toContain(t('ui.fleet.card.reach', { value: expected[tier] }));
    }
    expect(vehicleCardLine(getVehicleDefByTier('debris_hauler', 1))).not.toContain(t('ui.fleet.card.reach', { value: 12 }));
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
        const reachLine = t('ui.fleet.tip.reach', { value: DRILL_RIG_MAX_DEPTH_M[tier] });
        expect(tip.split('\n').filter(l => l !== reachLine)).toEqual([
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

  it('drill rig tooltips state the tier reach: 12 / 24 / 40 m (#1679)', () => {
    const expected = { 1: 12, 2: 24, 3: 40 } as const;
    for (const tier of TIERS) {
      const tip = vehicleCardTooltip(getVehicleDefByTier('drill_rig', tier));
      const reach = t('ui.fleet.tip.reach', { value: expected[tier] });
      expect(tip.split('\n')).toContain(reach);
      expect(reach).not.toMatch(/ui\.fleet\.tip/);
      expect(reach).toContain(String(expected[tier]));
    }
  });

  it('other vehicle roles carry no reach line (#1679)', () => {
    for (const role of getAllVehicleRoles().filter(r => r !== 'drill_rig')) {
      for (const tier of TIERS) {
        const tip = vehicleCardTooltip(getVehicleDefByTier(role, tier));
        expect(tip.split('\n')).toHaveLength(4);
      }
    }
  });

  it('reach line is translated in French (#1679)', () => {
    expect(EN['ui.fleet.tip.reach']).toBeDefined();
    expect(FR['ui.fleet.tip.reach']).toBeDefined();
    expect(FR['ui.fleet.tip.reach']).not.toBe(EN['ui.fleet.tip.reach']);
    setLocale('fr');
    expect(vehicleCardTooltip(getVehicleDefByTier('drill_rig', 2))).toContain(t('ui.fleet.tip.reach', { value: 24 }));
  });

  it('hauler capacity is a kg payload; destroyer and fragmenter are kg/h throughput', () => {
    expect(vehicleCardTooltip(getVehicleDefByTier('debris_hauler', 1))).toContain('Capacity: 4,000 kg');
    for (const role of ['rock_fragmenter', 'building_destroyer'] as const) {
      expect(vehicleCardTooltip(getVehicleDefByTier(role, 1))).toMatch(/Capacity: [\d,.]+ kg\/h/);
    }
  });

  it('charging truck tooltip falls back to the kg payload capacity (#1645)', () => {
    for (const tier of TIERS) {
      const tip = vehicleCardTooltip(getVehicleDefByTier('charging_truck', tier));
      expect(tip).toMatch(/Capacity: [\d,.]+ kg(?!\/h)/);
      expect(tip).not.toMatch(/kg\/h/);
      expect(tip).not.toMatch(/ui\.fleet\.tip/);
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

describe('vehicleCapacityText (#1850)', () => {
  it('drill rig reads in holes/h', () => {
    setLocale('en');
    expect(vehicleCapacityText('drill_rig', 2)).toBe('2 holes/h');
  });

  it('debris hauler reads a plain kg payload', () => {
    setLocale('en');
    expect(vehicleCapacityText('debris_hauler', 12)).toBe('12 kg');
  });

  it('rock digger reads m3/h and destroyer/fragmenter kg/h', () => {
    setLocale('en');
    expect(vehicleCapacityText('rock_digger', 5)).toBe(`5 ${t('ui.fleet.unit.m3_per_hour')}`);
    expect(vehicleCapacityText('building_destroyer', 5)).toBe('5 kg/h');
    expect(vehicleCapacityText('rock_fragmenter', 5)).toBe('5 kg/h');
  });

  it('agrees with the dealership tooltip capacity line for every role', () => {
    setLocale('en');
    for (const role of getAllVehicleRoles()) {
      const def = getVehicleDefByTier(role, 1);
      expect(vehicleCardTooltip(def)).toContain(vehicleCapacityText(role, def.capacity));
    }
  });
});

describe('buildingScoreEffectLines / buildingCardEffects (#1977)', () => {
  it('a positive effect renders as a signed +N line naming the score', () => {
    const lines = buildingScoreEffectLines(getBuildingDef('management_office', 1));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('+2');
    expect(lines[0]).toContain(t('score.safety'));
  });

  it('a negative effect renders with a minus sign', () => {
    const lines = buildingScoreEffectLines(getBuildingDef('explosive_warehouse', 1));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/[-\u2212]1/);
    expect(lines[0]).not.toContain('+');
    expect(lines[0]).toContain(t('score.safety'));
  });

  it('a building with no effects yields no lines and an empty card string', () => {
    const def = getBuildingDef('driving_center', 1);
    expect(buildingScoreEffectLines(def)).toEqual([]);
    expect(buildingCardEffects(def)).toBe('');
  });

  it('multiple effects give one line each, joined in the card string', () => {
    const def = getBuildingDef('management_office', 3);
    const lines = buildingScoreEffectLines(def);
    expect(lines).toHaveLength(2);
    expect(lines.some(l => l.includes('+4'))).toBe(true);
    expect(lines.some(l => l.includes('+1') && l.includes(t('score.wellBeing')))).toBe(true);
    const card = buildingCardEffects(def);
    for (const l of lines) expect(card).toContain(l);
  });

  it('score names follow the locale', () => {
    setLocale('fr');
    const line = buildingScoreEffectLines(getBuildingDef('management_office', 1))[0]!;
    expect(line).toContain(t('score.safety'));
    expect(line).toContain('+2');
  });
});
