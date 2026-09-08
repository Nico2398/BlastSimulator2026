// BlastSimulator2026 — Model asset ids
// One id per .glb under public/models/, derived from the core catalogs so a
// new role, vehicle or building tier names its asset without a second list.
// The Blender generators under assets/models/blender/ write the same names.

import type { EmployeeRole } from '../../core/entities/Employee.js';
import type { VehicleRole, VehicleTier } from '../../core/entities/Vehicle.js';
import type { BuildingTier, BuildingType } from '../../core/entities/Building.js';
import { BUILDING_DEFS } from '../../core/entities/BuildingDefs.js';
import { getAllVehicleRoles } from '../../core/entities/Vehicle.js';

export const EMPLOYEE_ROLES: readonly EmployeeRole[] = ['driller', 'blaster', 'driver', 'surveyor', 'manager'];
const BUILDING_TIERS: readonly BuildingTier[] = [1, 2, 3];

/** Rubble stand-in for any building at hp 0, scaled to its footprint. */
export const BUILDING_RUIN_MODEL_ID = 'building_ruin';

// ---------- Decorative props (assets/models/blender/props.py) ----------

/** Tree families, one per vegetation look; a biome picks one (see VegetationSway). */
export const TREE_FAMILIES = ['deciduous', 'conifer', 'tropical', 'desert', 'volcanic'] as const;
export type TreeFamily = (typeof TREE_FAMILIES)[number];
/** Variants per family — matches `TreePoint.variant`'s range. */
export const TREE_VARIANTS = 3;
export const BUSH_VARIANTS = 2;
export const ROCK_VARIANTS = 3;
export const HOUSE_VARIANTS = 3;
export const GRASS_VARIANTS = 3;
export const FLOWER_VARIANTS = 2;
/** The cartoon dust devil: one funnel model, spun and wandered by DustDevils. */
export const TWISTER_MODEL_ID = 'prop_twister';

export function treeModelId(family: TreeFamily, variant: number): string {
  return `prop_tree_${family}_${variant}`;
}

/** Decimated copy of a tree for the distant part of a forest (build.py exports it beside the detailed one). */
export function treeFarModelId(family: TreeFamily, variant: number): string {
  return `${treeModelId(family, variant)}_far`;
}

export function bushModelId(variant: number): string {
  return `prop_bush_${variant}`;
}

export function rockModelId(variant: number): string {
  return `prop_rock_${variant}`;
}

export function grassModelId(variant: number): string {
  return `prop_grass_${variant}`;
}

export function flowerModelId(variant: number): string {
  return `prop_flower_${variant}`;
}

export function houseModelId(variant: number): string {
  return `prop_house_${variant}`;
}

/** Every decorative prop asset. */
export function propModelIds(): string[] {
  const ids: string[] = [];
  for (const family of TREE_FAMILIES) {
    for (let v = 0; v < TREE_VARIANTS; v++) ids.push(treeModelId(family, v), treeFarModelId(family, v));
  }
  for (let v = 0; v < BUSH_VARIANTS; v++) ids.push(bushModelId(v));
  for (let v = 0; v < ROCK_VARIANTS; v++) ids.push(rockModelId(v));
  for (let v = 0; v < HOUSE_VARIANTS; v++) ids.push(houseModelId(v));
  for (let v = 0; v < GRASS_VARIANTS; v++) ids.push(grassModelId(v));
  for (let v = 0; v < FLOWER_VARIANTS; v++) ids.push(flowerModelId(v));
  ids.push(TWISTER_MODEL_ID);
  return ids;
}

export function workerModelId(role: EmployeeRole): string {
  return `worker_${role}`;
}

/** Each tier is its own model: tier 1 a junk caricature, tier 2 the plain machine, tier 3 the corporate monster. */
export const VEHICLE_TIERS: readonly VehicleTier[] = [1, 2, 3];

export function vehicleModelId(role: VehicleRole, tier: VehicleTier): string {
  return `vehicle_${role}_t${tier}`;
}

export function buildingModelId(type: BuildingType, tier: BuildingTier): string {
  return `building_${type}_t${tier}`;
}

/** Every asset the game can ask for — what the loading screen preloads. */
export function allModelIds(): string[] {
  const ids: string[] = [];
  for (const role of EMPLOYEE_ROLES) ids.push(workerModelId(role));
  for (const role of getAllVehicleRoles()) {
    for (const tier of VEHICLE_TIERS) ids.push(vehicleModelId(role, tier));
  }
  for (const type of Object.keys(BUILDING_DEFS) as BuildingType[]) {
    for (const tier of BUILDING_TIERS) ids.push(buildingModelId(type, tier));
  }
  ids.push(BUILDING_RUIN_MODEL_ID);
  ids.push(...propModelIds());
  return ids;
}

/** Served path of a model asset (Vite copies public/ to the site root). */
export function modelUrl(id: string, base = '/models/'): string {
  return `${base}${id}.glb`;
}
