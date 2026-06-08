// BlastSimulator2026 — NavGrid: 2D navigation surface derived from VoxelGrid
// Each cell represents walkability for A* pathfinding.
// Part of the navmesh system.

import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { Building } from '../entities/Building.js';
import type { DrillHole } from '../mining/DrillPlan.js';
import type { BlastRegion } from '../mining/BlastExecution.js';
import { isBuildingFootprintCell } from '../entities/BuildingPlacement.js';

export type NavCellType = 'walkable' | 'blocked' | 'drill_hole' | 'ramp' | 'void';

export interface NavCell {
  type: NavCellType;
  moveCost: number;
  benchLevel: number;
  vehicleOccupied: boolean;
}

export class NavGrid {
  readonly width: number;
  readonly height: number;
  readonly cells: NavCell[][];

  constructor(width: number, height: number, cells: NavCell[][]) {
    this.width = width;
    this.height = height;
    this.cells = cells;
  }

  /**
   * Find the highest solid voxel Y in column (x, z).
   * Returns the Y coordinate of the voxel (not y+1).
   * Returns -1 if the column is entirely void (no solid voxel with density >= 0.5).
   */
  static computeSurfaceY(voxelGrid: VoxelGrid, x: number, z: number): number {
    const cx = Math.max(0, Math.min(voxelGrid.sizeX - 1, Math.floor(x)));
    const cz = Math.max(0, Math.min(voxelGrid.sizeZ - 1, Math.floor(z)));
    for (let y = voxelGrid.sizeY - 1; y >= 0; y--) {
      const voxel = voxelGrid.getVoxel(cx, y, cz);
      if (voxel && voxel.density >= 0.5) return y;
    }
    return -1;
  }

  /**
   * Build a full NavGrid from the voxel grid, buildings, and drill holes.
   * Each cell is classified as walkable, blocked, drill_hole, ramp, or void.
   */
  static buildNavGrid(
    voxelGrid: VoxelGrid,
    buildings: Building[],
    drillHoles: DrillHole[],
  ): NavGrid {
    const width = voxelGrid.sizeX;
    const height = voxelGrid.sizeZ;
    const cells: NavCell[][] = [];

    for (let z = 0; z < height; z++) {
      const row: NavCell[] = [];
      for (let x = 0; x < width; x++) {
        const surfaceY = NavGrid.computeSurfaceY(voxelGrid, x, z);
        let type: NavCellType;

        if (surfaceY === -1) {
          type = 'void';
        } else if (drillHoles.some(h => Math.floor(h.x) === x && Math.floor(h.z) === z)) {
          type = 'drill_hole';
        } else if (buildings.some(b => isBuildingFootprintCell(b, x, z))) {
          type = 'blocked';
        } else {
          type = 'walkable';
        }

        row.push(NavGrid.makeCell(type));
      }
      cells.push(row);
    }

    return new NavGrid(width, height, cells);
  }

  /**
   * Patch a rectangular region of the NavGrid in place.
   * Only cells within the clamped region are recomputed; cells outside are untouched.
   */
  static patchNavGrid(
    navGrid: NavGrid,
    voxelGrid: VoxelGrid,
    buildings: Building[],
    drillHoles: DrillHole[],
    region: BlastRegion,
  ): void {
    const minX = Math.max(0, Math.min(navGrid.width - 1, region.minX));
    const maxX = Math.max(0, Math.min(navGrid.width - 1, region.maxX));
    const minZ = Math.max(0, Math.min(navGrid.height - 1, region.minZ));
    const maxZ = Math.max(0, Math.min(navGrid.height - 1, region.maxZ));

    if (minX > maxX || minZ > maxZ) return;

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const surfaceY = NavGrid.computeSurfaceY(voxelGrid, x, z);
        let type: NavCellType;

        if (surfaceY === -1) {
          type = 'void';
        } else if (drillHoles.some(h => Math.floor(h.x) === x && Math.floor(h.z) === z)) {
          type = 'drill_hole';
        } else if (buildings.some(b => isBuildingFootprintCell(b, x, z))) {
          type = 'blocked';
        } else {
          type = 'walkable';
        }

        navGrid.cells[z]![x] = NavGrid.makeCell(type);
      }
    }
  }

  /**
   * Create a NavCell with the given type and appropriate move cost.
   */
  private static makeCell(type: NavCellType): NavCell {
    let moveCost: number;
    switch (type) {
      case 'walkable': moveCost = 1.0; break;
      case 'ramp': moveCost = 1.8; break;
      case 'drill_hole': moveCost = 5.0; break;
      case 'blocked':
      case 'void': moveCost = Infinity; break;
    }
    return { type, moveCost, benchLevel: 0, vehicleOccupied: false };
  }
}
