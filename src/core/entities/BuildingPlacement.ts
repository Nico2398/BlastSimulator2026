// BlastSimulator2026 — Building placement grid
// Derives a 2D surface grid from the VoxelGrid and marks cells occupied by
// building footprints. Used for placement validation and rendering hints.

import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { BuildingType, BuildingTier } from './Building.js';
import { getBuildingDef, type BuildingState, type Building } from './Building.js';

// ── Types ──

/** Sentinel value: this cell is under an existing building's footprint. */
export const BUSY = -1 as const;

export type SurfaceY = number | typeof BUSY;

export interface PlacementCell {
  /** World-space X coordinate. */
  worldX: number;
  /** World-space Z coordinate. */
  worldZ: number;
  /**
   * Y of the highest solid voxel + 1 (i.e. the first empty layer above ground).
   * Set to BUSY if the cell is occupied by a building footprint.
   */
  surfaceY: SurfaceY;
}

export interface CanPlaceBuildingResult {
  valid: boolean;
  reason?: string;
}

/** A 2-D grid indexed as [z][x] of PlacementCell. */
export type PlacementGrid = PlacementCell[][];

// ── Functions ──

/**
 * Build a placement grid by scanning every (x, z) column of the VoxelGrid for
 * its surface height, then marking cells covered by building footprints as BUSY.
 */
export function buildPlacementGrid(
  voxelGrid: VoxelGrid,
  buildingState: BuildingState,
): PlacementGrid {
  const grid: PlacementGrid = [];

  for (let z = 0; z < voxelGrid.sizeZ; z++) {
    const row: PlacementCell[] = [];
    for (let x = 0; x < voxelGrid.sizeX; x++) {
      row.push({ worldX: x, worldZ: z, surfaceY: getSurfaceY(voxelGrid, x, z) });
    }
    grid.push(row);
  }

  // Mark every cell that falls under a building footprint as BUSY.
  for (const building of buildingState.buildings) {
    const def = getBuildingDef(building.type, building.tier);
    for (const [dx, dz] of def.footprint) {
      const cx = building.x + dx;
      const cz = building.z + dz;
      const row = grid[cz];
      if (row !== undefined && cx >= 0 && cx < row.length) {
        const cell = row[cx];
        if (cell !== undefined) cell.surfaceY = BUSY;
      }
    }
  }

  return grid;
}

/**
 * Return the Y coordinate of the first empty layer above the highest solid
 * voxel in column (x, z), or 0 if the entire column is empty.
 */
export function getSurfaceY(voxelGrid: VoxelGrid, x: number, z: number): number {
  for (let y = voxelGrid.sizeY - 1; y >= 0; y--) {
    const voxel = voxelGrid.getVoxel(x, y, z);
    if (voxel !== undefined && voxel.density > 0) return y + 1;
  }
  return 0;
}

/**
 * Check whether a building of the given type and tier can be placed at (x, z)
 * on the provided PlacementGrid.
 *
 * Checks (in order per footprint cell):
 *   1. All cells are within grid bounds.
 *   2. No cell is marked BUSY (occupied by an existing building).
 *   3. All cells share the same surfaceY (flat surface required).
 *
 * Returns `{ valid: true }` when all checks pass, or `{ valid: false, reason }`
 * describing the first failure encountered.
 */
export function canPlaceBuilding(
  grid: PlacementGrid,
  type: BuildingType,
  x: number,
  z: number,
  tier: BuildingTier = 1,
): CanPlaceBuildingResult {
  const def = getBuildingDef(type, tier);
  const gridSizeZ = grid.length;

  let referenceSurfaceY: number | undefined;

  for (const [dx, dz] of def.footprint) {
    const cx = x + dx;
    const cz = z + dz;

    if (cz < 0 || cz >= gridSizeZ) {
      return { valid: false, reason: 'Out of bounds' };
    }
    const row = grid[cz]!;
    if (cx < 0 || cx >= row.length) {
      return { valid: false, reason: 'Out of bounds' };
    }

    const cell = row[cx]!;

    if (cell.surfaceY === BUSY) {
      return { valid: false, reason: 'Space is occupied' };
    }

    if (referenceSurfaceY === undefined) {
      referenceSurfaceY = cell.surfaceY;
    } else if (cell.surfaceY !== referenceSurfaceY) {
      return { valid: false, reason: 'Uneven surface' };
    }
  }

  return { valid: true };
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
