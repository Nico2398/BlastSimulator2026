// BlastSimulator2026 — Pre-placed starting buildings (#1363)
// Places a level's opening buildings on real ground once terrain exists.

import { placeBuilding, getBuildingDef, getDefSize, footprintHeightSpread, type BuildingState } from '../entities/Building.js';
import { getSurfaceY } from '../entities/BuildingPlacement.js';
import { siteBoundsForGrid, levelBuildingFootprint } from '../engine/BuildingTaskHelpers.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import {
  BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD,
  RALLY_POINT_BUILDING_CLEARANCE,
  STARTING_SITE_STAFFED_COMPOSITION,
  type StartingBuildingSlot,
  type StartingSiteComposition,
} from '../config/balance.js';
import { ringCells } from './SpawnPlacement.js';

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
 * The footprint of a `sizeX` x `sizeZ` building at the origin, grown by a
 * one-cell margin on every side: the ground a building is judged flat by.
 */
function footprintWithMargin(sizeX: number, sizeZ: number): Array<readonly [number, number]> {
  const cells: Array<readonly [number, number]> = [];
  for (let dz = -1; dz <= sizeZ; dz++) {
    for (let dx = -1; dx <= sizeX; dx++) cells.push([dx, dz]);
  }
  return cells;
}

/** Chebyshev gap between a footprint rect and a single cell; 0 when the cell lies inside it. */
function gapToCell(x: number, z: number, sizeX: number, sizeZ: number, cell: { x: number; z: number }): number {
  const dx = cell.x < x ? x - cell.x : (cell.x > x + sizeX - 1 ? cell.x - (x + sizeX - 1) : 0);
  const dz = cell.z < z ? z - cell.z : (cell.z > z + sizeZ - 1 ? cell.z - (z + sizeZ - 1) : 0);
  return Math.max(dx, dz);
}

/**
 * Places each slot on free, buildable ground as close to `near` as possible.
 * Searches rings outward from `near`; no cash is deducted. Each placed building
 * has its footprint levelled on the spot (the same carve-then-level a finished
 * build gets), so it stands on a flat pad and later slots land on levelled
 * ground. Call before the navgrid is built. Returns the number of buildings
 * actually placed (a slot that fits nowhere is skipped).
 *
 * A building goes on flat ground, not merely on a footprint that passes the
 * one-level placement tolerance: the first pass wants the footprint plus a
 * one-cell margin within `BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD`, so a spoil
 * heap is not dropped on a hillside. With `rallyPoint`, the footprint also
 * keeps `RALLY_POINT_BUILDING_CLEARANCE` cells from the flag, whose ground
 * belongs to the crew that spawns there. Each pass relaxes one rule when the
 * site has no room for it, so a slot is only ever skipped where it fits nowhere.
 */
export function placeStartingBuildings(
  buildings: BuildingState,
  grid: VoxelGrid,
  slots: readonly StartingBuildingSlot[],
  near: { x: number; z: number },
  rallyPoint?: { x: number; z: number },
): number {
  const bounds = siteBoundsForGrid(grid);
  const cx = Math.round(near.x);
  const cz = Math.round(near.z);
  const maxRadius = Math.max(bounds.width, bounds.depth);
  const heightAt = (x: number, z: number): number => getSurfaceY(grid, x, z);
  let placed = 0;

  for (const slot of slots) {
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(slot.type, slot.tier));
    const margin = footprintWithMargin(sizeX, sizeZ);
    const flatSurroundings = (x: number, z: number): boolean =>
      footprintHeightSpread(margin, x, z, heightAt) <= BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD;
    const clearOfFlag = (x: number, z: number): boolean =>
      rallyPoint === undefined || gapToCell(x, z, sizeX, sizeZ, rallyPoint) >= RALLY_POINT_BUILDING_CLEARANCE;
    const passes: ReadonlyArray<(x: number, z: number) => boolean> = [
      (x, z) => clearOfFlag(x, z) && flatSurroundings(x, z),
      clearOfFlag,
      () => true,
    ];

    search: for (const accepts of passes) {
      for (let r = 0; r <= maxRadius; r++) {
        for (const cell of ringCells({ x: cx, z: cz }, r)) {
          if (!accepts(cell.x, cell.z)) continue;
          const result = placeBuilding(
            buildings, slot.type, cell.x, cell.z, bounds.width, bounds.depth,
            slot.tier, bounds.originX, bounds.originZ, undefined, grid,
          );
          if (result.success) {
            levelBuildingFootprint(grid, cell.x, cell.z, sizeX, sizeZ);
            placed++;
            break search;
          }
        }
      }
    }
  }
  return placed;
}
