// BlastSimulator2026 — Building placement helpers
// `getSurfaceY`: ground-truth surface height a footprint check samples.
// `isBuildingFootprintCell`: absolute-cell membership test for rendering hints.
// Flatness/occupancy validation itself lives in `Building.ts`'s
// `checkFootprintPlacement` (#1008) — this file no longer duplicates it.

import { type VoxelGrid, computeVoxelColumnSurfaceY } from '../world/VoxelGrid.js';
import { getBuildingDef, type Building } from './Building.js';

// Re-exported so `Building.ts` (the real placement path) can take a `VoxelGrid`
// parameter without importing `../world/VoxelGrid.js` directly (#1008).
export type { VoxelGrid };

/**
 * Return the Y coordinate of the first empty layer above the highest solid
 * voxel in column (x, z), or 0 if the entire column is empty.
 */
export function getSurfaceY(voxelGrid: VoxelGrid, x: number, z: number): number {
  return computeVoxelColumnSurfaceY(voxelGrid, x, z) + 1;
}

/**
 * Returns true if the absolute grid cell (ax, az) falls within the given
 * building's footprint.
 */
export function isBuildingFootprintCell(building: Building, ax: number, az: number): boolean {
  const def = getBuildingDef(building.type, building.tier);
  for (const [dx, dz] of def.footprint) {
    if (building.x + dx === ax && building.z + dz === az) return true;
  }
  return false;
}
