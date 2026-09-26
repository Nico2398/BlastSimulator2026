// BlastSimulator2026 — Building placement helpers
// `getSurfaceY`: ground-truth surface height a footprint check samples.
// `isBuildingFootprintCell`: absolute-cell membership test for rendering hints.
// Flatness/occupancy validation itself lives in `Building.ts`'s
// `checkFootprintPlacement` (#1008) — this file no longer duplicates it.

import { type VoxelGrid, firstEmptyLayerAboveGround } from '../world/VoxelGrid.js';
import { getBuildingDef, type FootprintOccupant } from './Building.js';

// Re-exported so `Building.ts` (the real placement path) can take a `VoxelGrid`
// parameter without importing `../world/VoxelGrid.js` directly (#1008).
export type { VoxelGrid };

/**
 * Return the Y coordinate of the first empty layer above the highest solid
 * voxel in column (x, z), or 0 if the entire column is empty.
 */
export function getSurfaceY(voxelGrid: VoxelGrid, x: number, z: number): number {
  return firstEmptyLayerAboveGround(voxelGrid, x, z);
}

/**
 * Returns true if the absolute grid cell (ax, az) falls within the given
 * occupant's footprint (a live `Building` or a still-planned
 * `FootprintOccupant`, #1200).
 */
export function isBuildingFootprintCell(occupant: FootprintOccupant, ax: number, az: number): boolean {
  const def = getBuildingDef(occupant.type, occupant.tier);
  for (const [dx, dz] of def.footprint) {
    if (occupant.x + dx === ax && occupant.z + dz === az) return true;
  }
  return false;
}
