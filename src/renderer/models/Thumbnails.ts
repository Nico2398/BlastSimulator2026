// BlastSimulator2026 — Portrait thumbnails (#2241)
// One pre-rendered picture per worker role, vehicle role and tier, and
// building type and tier, generated from the same .glb the scene draws
// (`npm run thumbs:build`, scripts/render-thumbnails.ts, which drives
// thumbs.html) and committed under public/thumbs/. The UI shows them in the
// inspector header and on every grid card; pre-rendering keeps a card grid of
// twenty vehicles as cheap as twenty <img> tags.

import type { EmployeeRole } from '../../core/entities/Employee.js';
import { getAllVehicleRoles } from '../../core/entities/Vehicle.js';
import { BUILDING_TIERS, isSingleTierType, type BuildingType } from '../../core/entities/Building.js';
import { BUILDING_DEFS } from '../../core/entities/BuildingDefs.js';
import { buildingModelId, EMPLOYEE_ROLES, VEHICLE_TIERS, vehicleModelId, workerModelId } from './ModelIds.js';

/** Edge of every thumbnail, in px: 2× the largest size a card shows it at. */
export const THUMB_SIZE_PX = 256;

type ThumbFamily = 'worker' | 'vehicle' | 'building';

/** How one model is framed: orbit angles (degrees), the height aimed at (fraction of the model), and zoom. */
export interface ThumbShot {
  readonly id: string;
  readonly family: ThumbFamily;
  /** Worker shots tint the garment and hat by role, as CharacterMesh does. */
  readonly role?: EmployeeRole;
  readonly yaw: number;
  readonly pitch: number;
  readonly focusY: number;
  readonly zoom: number;
}

/**
 * Per-family framing. Yaw 0 puts the camera on the model's +X axis — the side
 * workers and vehicles face — and turns toward +Z; buildings face -Z (their
 * door row, `models.md`), so their three-quarter view starts from -90.
 * Workers are a head-and-shoulders bust, machines and buildings a hero shot.
 */
const FRAMING: Record<ThumbFamily, Pick<ThumbShot, 'yaw' | 'pitch' | 'focusY' | 'zoom'>> = {
  worker: { yaw: 28, pitch: 8, focusY: 0.71, zoom: 1.62 },
  vehicle: { yaw: 38, pitch: 22, focusY: 0.44, zoom: 1.2 },
  building: { yaw: -58, pitch: 26, focusY: 0.44, zoom: 1.16 },
};

/** Every thumbnail the game ships, in a stable order. */
export function thumbnailShots(): ThumbShot[] {
  const shots: ThumbShot[] = [];
  for (const role of EMPLOYEE_ROLES) shots.push({ id: workerModelId(role), family: 'worker', role, ...FRAMING.worker });
  for (const role of getAllVehicleRoles()) {
    for (const tier of VEHICLE_TIERS) shots.push({ id: vehicleModelId(role, tier), family: 'vehicle', ...FRAMING.vehicle });
  }
  for (const type of Object.keys(BUILDING_DEFS) as BuildingType[]) {
    const tiers = isSingleTierType(type) ? [BUILDING_TIERS[0]!] : BUILDING_TIERS;
    for (const tier of tiers) shots.push({ id: buildingModelId(type, tier), family: 'building', ...FRAMING.building });
  }
  return shots;
}

/** Served path of a thumbnail (Vite copies public/ to the site root). */
export function thumbnailUrl(id: string, base = '/thumbs/'): string {
  return `${base}${id}.webp`;
}
