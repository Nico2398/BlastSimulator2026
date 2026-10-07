// BlastSimulator2026 — Pre-placed starting buildings (#1363)
// Places a level's opening buildings on real ground once terrain exists.

import { placeBuilding, type BuildingState } from '../entities/Building.js';
import { siteBoundsForGrid } from '../engine/BuildingTaskHelpers.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { StartingBuildingSlot } from '../config/balance.js';

/** Cells at Chebyshev distance `r` from (cx, cz), in a fixed order. */
function* ringCells(cx: number, cz: number, r: number): Generator<{ x: number; z: number }> {
  if (r === 0) {
    yield { x: cx, z: cz };
    return;
  }
  for (let dx = -r; dx <= r; dx++) {
    yield { x: cx + dx, z: cz - r };
    yield { x: cx + dx, z: cz + r };
  }
  for (let dz = -r + 1; dz <= r - 1; dz++) {
    yield { x: cx - r, z: cz + dz };
    yield { x: cx + r, z: cz + dz };
  }
}

/**
 * Places each slot on free, buildable ground as close to `near` as possible.
 * Searches rings outward from `near`; no cash is deducted. Returns the number
 * of buildings actually placed (a slot that fits nowhere is skipped).
 */
export function placeStartingBuildings(
  buildings: BuildingState,
  grid: VoxelGrid,
  slots: readonly StartingBuildingSlot[],
  near: { x: number; z: number },
): number {
  const bounds = siteBoundsForGrid(grid);
  const cx = Math.round(near.x);
  const cz = Math.round(near.z);
  const maxRadius = Math.max(bounds.width, bounds.depth);
  let placed = 0;

  for (const slot of slots) {
    search: for (let r = 0; r <= maxRadius; r++) {
      for (const cell of ringCells(cx, cz, r)) {
        const result = placeBuilding(
          buildings, slot.type, cell.x, cell.z, bounds.width, bounds.depth,
          slot.tier, bounds.originX, bounds.originZ, undefined, grid,
        );
        if (result.success) {
          placed++;
          break search;
        }
      }
    }
  }
  return placed;
}
