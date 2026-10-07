import type { VehicleDef, VehicleRole } from '../core/entities/Vehicle.js';
import { getFootprintSize, type BuildingDef, type BuildingType } from '../core/entities/Building.js';
import { t } from '../core/i18n/I18n.js';
import { formatMoney } from '../core/economy/formatMoney.js';

/**
 * i18n key of the capacity unit shown for each building type (ui.build.unit.*);
 * null when nothing enforces a capacity, so the tooltip omits the line.
 */
export const BUILDING_CAPACITY_UNIT_KEY: Record<BuildingType, string | null> = {
  driving_center: 'ui.build.unit.seats',
  blasting_academy: 'ui.build.unit.seats',
  management_office: 'ui.build.unit.seats',
  geology_lab: 'ui.build.unit.seats',
  research_center: null,
  living_quarters: 'ui.build.unit.beds',
  explosive_warehouse: 'ui.build.unit.kg',
  freight_warehouse: 'ui.build.unit.kg',
  vehicle_depot: 'ui.build.unit.vehicles',
};

/** i18n key of the work-capacity unit for roles whose capacity is not a kg payload. */
const VEHICLE_WORK_UNIT_KEY: Partial<Record<VehicleRole, string>> = {
  rock_digger: 'ui.fleet.unit.m3_per_hour',
  drill_rig: 'ui.fleet.unit.holes_per_hour',
  building_destroyer: 'ui.fleet.unit.kg_per_hour',
  rock_fragmenter: 'ui.fleet.unit.kg_per_hour',
};

/** Card number: up to 2 decimals, whole values grouped like every other money/amount figure. */
const num = (n: number): string => {
  const r = Number(n.toFixed(2));
  return Number.isInteger(r) ? formatMoney(r) : String(r);
};

const cardLine = (desc: string, perHour: string): string => t('ui.card.line', { desc, cost: perHour });

/** Cost per tick (1 tick = 1 hour) rendered as whole dollars per hour. */
export function formatPerHour(costPerTick: number): string {
  return t('ui.card.per_hour', { cost: formatMoney(costPerTick) });
}

/** One-line card text: role description plus hourly running cost. */
export function vehicleCardLine(def: VehicleDef): string {
  return cardLine(t(`vehicle.${def.type}.desc`), formatPerHour(def.maintenanceCostPerTick + def.fuelCostPerTick));
}

/** Tooltip: speed, capacity, work rate, licence level. */
export function vehicleCardTooltip(def: VehicleDef): string {
  const unitKey = VEHICLE_WORK_UNIT_KEY[def.type];
  const capacity = unitKey
    ? t('ui.fleet.tip.capacity_work', { value: num(def.capacity), unit: t(unitKey) })
    : t('ui.fleet.tip.capacity_kg', { value: num(def.capacity) });
  return [
    t('ui.fleet.tip.speed', { value: num(def.speed) }),
    capacity,
    t('ui.fleet.tip.work_rate', { value: num(def.workRate) }),
    t('ui.fleet.tip.licence', { tier: def.tier }),
  ].join('\n');
}

/** One-line card text: building description plus hourly operating cost. */
export function buildingCardLine(def: BuildingDef): string {
  return cardLine(t(`building.${def.type}.desc`), formatPerHour(def.operatingCostPerTick));
}

/** Tooltip: footprint, capacity with unit, upkeep per hour. */
export function buildingCardTooltip(def: BuildingDef): string {
  const { sizeX, sizeZ } = getFootprintSize(def.footprint);
  const unitKey = BUILDING_CAPACITY_UNIT_KEY[def.type];
  return [
    t('ui.build.tip.footprint', { w: sizeX, h: sizeZ }),
    ...(unitKey ? [t('ui.build.tip.capacity', { value: num(def.capacity), unit: t(unitKey) })] : []),
    t('ui.build.tip.upkeep', { cost: formatPerHour(def.operatingCostPerTick) }),
  ].join('\n');
}
