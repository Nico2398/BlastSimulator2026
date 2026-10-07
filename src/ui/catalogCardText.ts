import type { VehicleDef } from '../core/entities/Vehicle.js';
import type { BuildingDef, BuildingType } from '../core/entities/Building.js';

/** i18n key of the capacity unit shown for each building type (ui.build.unit.*). */
export const BUILDING_CAPACITY_UNIT_KEY: Record<BuildingType, string> = {
  driving_center: '',
  blasting_academy: '',
  management_office: '',
  geology_lab: '',
  research_center: '',
  living_quarters: '',
  explosive_warehouse: '',
  freight_warehouse: '',
  vehicle_depot: '',
}; // TODO: implement

/** Cost per tick (1 tick = 1 hour) rendered as whole dollars per hour. */
export function formatPerHour(_costPerTick: number): string {
  return ''; // TODO: implement
}

/** One-line card text: role description plus hourly running cost. */
export function vehicleCardLine(_def: VehicleDef): string {
  return ''; // TODO: implement
}

/** Tooltip: speed, capacity, work rate, licence level. */
export function vehicleCardTooltip(_def: VehicleDef): string {
  return ''; // TODO: implement
}

/** One-line card text: building description plus hourly operating cost. */
export function buildingCardLine(_def: BuildingDef): string {
  return ''; // TODO: implement
}

/** Tooltip: footprint, capacity with unit, upkeep per hour. */
export function buildingCardTooltip(_def: BuildingDef): string {
  return ''; // TODO: implement
}
