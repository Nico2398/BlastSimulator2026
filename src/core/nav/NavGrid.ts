// BlastSimulator2026 — NavGrid: 2D navigation surface derived from VoxelGrid
// Each cell represents walkability for A* pathfinding.
// Part of the navmesh system.

import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { Building } from '../entities/Building.js';
import type { DrillHole } from '../mining/DrillPlan.js';
import type { BlastRegion } from '../mining/BlastExecution.js';

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

  static buildNavGrid(
    _voxelGrid: VoxelGrid,
    _buildings: Building[],
    _drillHoles: DrillHole[],
  ): NavGrid {
    // TODO: implement
    return new NavGrid(0, 0, []);
  }

  static patchNavGrid(
    _navGrid: NavGrid,
    _voxelGrid: VoxelGrid,
    _buildings: Building[],
    _drillHoles: DrillHole[],
    _region: BlastRegion,
  ): void {
    // TODO: implement
  }

  static computeSurfaceY(
    _voxelGrid: VoxelGrid,
    _x: number,
    _z: number,
  ): number {
    // TODO: implement
    return -1;
  }
}
