import type { VehicleDef, VehicleRole } from '../core/entities/Vehicle.js';
import { getFootprintSize, type BuildingDef, type BuildingType } from '../core/entities/Building.js';
import { t } from '../core/i18n/I18n.js';

/** i18n key of the capacity unit shown for each building type (ui.build.unit.*). */
const BUILDING_CAPACITY_UNIT_KEY: Record<BuildingType, string> = {
  driving_center: 'ui.build.unit.seats',
  blasting_academy: 'ui.build.unit.seats',
  management_office: 'ui.build.unit.seats',
  geology_lab: 'ui.build.unit.seats',
  research_center: 'ui.build.unit.researchers',
  living_quarters: 'ui.build.unit.beds',
  explosive_warehouse: 'ui.build.unit.kg',
  freight_warehouse: 'ui.build.unit.kg',
  vehicle_depot: 'ui.build.unit.vehicles',
};

/** i18n key of the work-capacity unit for roles whose capacity is not a kg payload. */
const VEHICLE_WORK_UNIT_KEY: Partial<Record<VehicleRole, string>> = {
  rock_digger: 'ui.fleet.unit.m3_per_tick',
  drill_rig: 'ui.fleet.unit.holes_per_tick',
};

const num = (n: number): string => String(Number(n.toFixed(2)));

/** Cost per tick (1 tick = 1 hour) rendered as whole dollars per hour. */
export function formatPerHour(costPerTick: number): string {
  return t('ui.card.per_hour', { cost: Math.round(costPerTick) });
}

/** One-line card text: role description plus hourly running cost. */
export function vehicleCardLine(def: VehicleDef): string {
  return `${t(`vehicle.${def.type}.desc`)} · ${formatPerHour(def.maintenanceCostPerTick + def.fuelCostPerTick)}`;
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
  return `${t(`building.${def.type}.desc`)} · ${formatPerHour(def.operatingCostPerTick)}`;
}

/** Tooltip: footprint, capacity with unit, upkeep per hour. */
export function buildingCardTooltip(def: BuildingDef): string {
  const { sizeX, sizeZ } = getFootprintSize(def.footprint);
  return [
    t('ui.build.tip.footprint', { w: sizeX, h: sizeZ }),
    t('ui.build.tip.capacity', { value: def.capacity.toLocaleString('en-US'), unit: t(BUILDING_CAPACITY_UNIT_KEY[def.type]) }),
    t('ui.build.tip.upkeep', { cost: formatPerHour(def.operatingCostPerTick) }),
  ].join('\n');
}
