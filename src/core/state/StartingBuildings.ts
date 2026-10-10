// BlastSimulator2026 — Pre-placed starting buildings (#1363)
// Places a level's opening buildings on real ground once terrain exists.

import { placeBuilding, getBuildingDef, getDefSize, type BuildingState } from '../entities/Building.js';
import { siteBoundsForGrid, levelBuildingFootprint } from '../engine/BuildingTaskHelpers.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import {
  STARTING_BUILDING_STANDOFF_M,
  STARTING_SITE_STAFFED_COMPOSITION,
  type StartingBuildingSlot,
  type StartingSiteComposition,
} from '../config/balance.js';
import { meanPosition, ringCells } from './SpawnPlacement.js';

/**
 * Where a level's opening buildings start their placement search: the crew's
 * centroid, stood off `STARTING_BUILDING_STANDOFF_M` toward the site centre. A
 * footprint dropped on the crew's own cluster can wall the vehicles into a
 * pocket (#1363).
 */
export function startingBuildingAnchor(
  crew: ReadonlyArray<{ x: number; z: number }>,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): { x: number; z: number } {
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;
  // No crew (the tutorial's heap-only site): stand off east of the site centre.
  // The centre is where the tutorial's vehicles spawn and its box-cut corridor
  // starts; its scripted builds sit west, so east stays clear of all of them.
  if (crew.length === 0) return { x: centreX + STARTING_BUILDING_STANDOFF_M, z: centreZ };
  const centroid = meanPosition(crew);
  const toCentreX = centreX - centroid.x;
  const toCentreZ = centreZ - centroid.z;
  const distance = Math.hypot(toCentreX, toCentreZ) || 1;
  return {
    x: centroid.x + (toCentreX / distance) * STARTING_BUILDING_STANDOFF_M,
    z: centroid.z + (toCentreZ / distance) * STARTING_BUILDING_STANDOFF_M,
  };
}

/**
 * Resolves the tri-state `staffed` opt-in against a level's own site (#1363):
 * undefined keeps `levelSite`, true the global staffed composition, false a
 * bare site (undefined).
 */
export function resolveStartingSite(
  levelSite: StartingSiteComposition | undefined,
  staffed: boolean | undefined,
): StartingSiteComposition | undefined {
  if (staffed === undefined) return levelSite;
  return staffed ? STARTING_SITE_STAFFED_COMPOSITION : undefined;
}

/** True when the site starts with at least one employee or vehicle. */
export function isStaffedComposition(site: StartingSiteComposition | undefined): boolean {
  return site !== undefined && (site.employees.length > 0 || site.vehicles.length > 0);
}

/**
 * Places each slot on free, buildable ground as close to `near` as possible.
 * Searches rings outward from `near`; no cash is deducted. Each placed building
 * has its footprint levelled on the spot (the same carve-then-level a finished
 * build gets), so it stands on a flat pad and later slots land on levelled
 * ground. Call before the navgrid is built. Returns the number of buildings
 * actually placed (a slot that fits nowhere is skipped).
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
      for (const cell of ringCells({ x: cx, z: cz }, r)) {
        const result = placeBuilding(
          buildings, slot.type, cell.x, cell.z, bounds.width, bounds.depth,
          slot.tier, bounds.originX, bounds.originZ, undefined, grid,
        );
        if (result.success) {
          const { sizeX, sizeZ } = getDefSize(getBuildingDef(slot.type, slot.tier));
          levelBuildingFootprint(grid, cell.x, cell.z, sizeX, sizeZ);
          placed++;
          break search;
        }
      }
    }
  }
  return placed;
}
