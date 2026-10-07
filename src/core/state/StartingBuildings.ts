// BlastSimulator2026 — Pre-placed starting buildings (#1363)
// Places a level's opening buildings on real ground once terrain exists.

import type { BuildingState } from '../entities/Building.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { StartingBuildingSlot } from '../config/balance.js';

/**
 * Places each slot on free, buildable ground as close to `near` as possible.
 * Returns the number of buildings actually placed.
 */
export function placeStartingBuildings(
  _buildings: BuildingState,
  _grid: VoxelGrid,
  _slots: readonly StartingBuildingSlot[],
  _near: { x: number; z: number },
): number {
  return 0; // TODO: implement
}
