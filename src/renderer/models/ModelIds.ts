// BlastSimulator2026 — Model asset ids
// One id per .glb under public/models/, derived from the core catalogs so a
// new role, vehicle or building tier names its asset without a second list.
// The Blender generators under assets/models/blender/ write the same names.

import type { EmployeeRole } from '../../core/entities/Employee.js';
import type { VehicleRole } from '../../core/entities/Vehicle.js';
import type { BuildingTier, BuildingType } from '../../core/entities/Building.js';
import { BUILDING_DEFS } from '../../core/entities/BuildingDefs.js';
import { getAllVehicleRoles } from '../../core/entities/Vehicle.js';

export const EMPLOYEE_ROLES: readonly EmployeeRole[] = ['driller', 'blaster', 'driver', 'surveyor', 'manager'];
const BUILDING_TIERS: readonly BuildingTier[] = [1, 2, 3];

/** Rubble stand-in for any building at hp 0, scaled to its footprint. */
export const BUILDING_RUIN_MODEL_ID = 'building_ruin';

export function workerModelId(role: EmployeeRole): string {
  return `worker_${role}`;
}

export function vehicleModelId(role: VehicleRole): string {
  return `vehicle_${role}`;
}

export function buildingModelId(type: BuildingType, tier: BuildingTier): string {
  return `building_${type}_t${tier}`;
}

/** Every asset the game can ask for — what the loading screen preloads. */
export function allModelIds(): string[] {
  const ids: string[] = [];
  for (const role of EMPLOYEE_ROLES) ids.push(workerModelId(role));
  for (const role of getAllVehicleRoles()) ids.push(vehicleModelId(role));
  for (const type of Object.keys(BUILDING_DEFS) as BuildingType[]) {
    for (const tier of BUILDING_TIERS) ids.push(buildingModelId(type, tier));
  }
  ids.push(BUILDING_RUIN_MODEL_ID);
  return ids;
}

/** Served path of a model asset (Vite copies public/ to the site root). */
export function modelUrl(id: string, base = '/models/'): string {
  return `${base}${id}.glb`;
}
