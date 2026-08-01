// BlastSimulator2026 — NavGrid: 2D navigation surface derived from VoxelGrid
// Each cell represents walkability for A* pathfinding.
// Part of the navmesh system.

import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../world/VoxelGrid.js';
import type { Building } from '../entities/Building.js';
import type { DrillHole } from '../mining/DrillPlan.js';
import type { BlastRegion } from '../mining/BlastExecution.js';
import { isBuildingFootprintCell } from '../entities/BuildingPlacement.js';
import { NAV_BENCH_HEIGHT } from '../config/balance.js';

/** Cardinal offsets for 4-directional neighbor checks. */
const CARDINAL_OFFSETS: readonly [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export type NavCellType = 'walkable' | 'blocked' | 'drill_hole' | 'ramp' | 'void';

export interface NavCell {
  type: NavCellType;
  moveCost: number;
  benchLevel: number;
  /**
   * Reserved for a future per-cell vehicle-occupancy pass (checked by
   * Pathfinding.findPath/AgentMovement.isPathBlocked when a caller requests
   * avoidVehicles). No caller in src/ ever sets this true — EntityMovementTick's
   * tickVehicle/tickEmployeeMovement both request avoidVehicles:false and
   * instead do vehicle-vs-vehicle collision avoidance by comparing live x/z
   * directly (see isCellOccupiedByOtherVehicle in EntityMovementTick.ts) — so
   * this field is always false today and the avoidVehicles checks against it
   * are a no-op.
   */
  vehicleOccupied: boolean;
}

export class NavGrid {
  readonly width: number;
  readonly height: number;
  readonly maxSurfaceY: number;
  readonly cells: NavCell[][];

  constructor(width: number, height: number, cells: NavCell[][], maxSurfaceY: number = 0) {
    this.width = width;
    this.height = height;
    this.maxSurfaceY = maxSurfaceY;
    this.cells = cells;
  }

  /**
   * Find the highest solid voxel Y in column (x, z).
   * Returns the Y coordinate of the voxel (not y+1).
   * Returns -1 if the column is entirely void (no solid voxel with density >= 0.5).
   * Out-of-bounds (x, z) coordinates are clamped to the grid limits.
   */
  static computeSurfaceY(voxelGrid: VoxelGrid, x: number, z: number): number {
    return computeVoxelColumnSurfaceY(voxelGrid, x, z);
  }

  /**
   * Compute the maximum surface Y across all columns in the voxel grid.
   * Returns -1 if the entire grid is void/empty.
   */
  static computeMaxSurfaceY(voxelGrid: VoxelGrid): number {
    let maxY = -1;
    for (let z = 0; z < voxelGrid.sizeZ; z++) {
      for (let x = 0; x < voxelGrid.sizeX; x++) {
        const surfaceY = NavGrid.computeSurfaceY(voxelGrid, x, z);
        if (surfaceY > maxY) maxY = surfaceY;
      }
    }
    return maxY;
  }

  /**
   * Compute the bench level for a cell given its surface Y and the max surface Y.
   * Returns 0 if surfaceY < 0 (void cell).
   */
  static computeBenchLevel(maxSurfaceY: number, surfaceY: number): number {
    if (surfaceY < 0) return 0;
    return Math.floor((maxSurfaceY - surfaceY) / NAV_BENCH_HEIGHT);
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
    const maxSurfaceY = NavGrid.computeMaxSurfaceY(voxelGrid);

    for (let z = 0; z < height; z++) {
      const row: NavCell[] = [];
      for (let x = 0; x < width; x++) {
        const surfaceY = NavGrid.computeSurfaceY(voxelGrid, x, z);
        const cellType = NavGrid.classifyCellType(x, z, voxelGrid, buildings, drillHoles, surfaceY);
        const benchLevel = NavGrid.computeBenchLevel(maxSurfaceY, surfaceY);
        row.push(NavGrid.makeCell(cellType, benchLevel));
      }
      cells.push(row);
    }

    return new NavGrid(width, height, cells, maxSurfaceY);
  }

  /**
   * Patch a rectangular region of the NavGrid in place.
   * The `navGrid` argument is mutated directly — no new NavGrid is created.
   * Only cells within the clamped region are recomputed; cells outside are untouched.
   */
  static patchNavGrid(
    navGrid: NavGrid,
    voxelGrid: VoxelGrid,
    buildings: Building[],
    drillHoles: DrillHole[],
    region: BlastRegion,
  ): void {
    // Detect empty sentinel region (e.g. {minX:0, maxX:-1, minZ:0, maxZ:-1})
    // before clamping, since clamping would collapse min/max to the same value
    // and fail the min > max check.
    if (region.minX > region.maxX || region.minZ > region.maxZ) return;

    const minX = Math.max(0, Math.min(navGrid.width - 1, Math.floor(region.minX)));
    const maxX = Math.max(0, Math.min(navGrid.width - 1, Math.floor(region.maxX)));
    const minZ = Math.max(0, Math.min(navGrid.height - 1, Math.floor(region.minZ)));
    const maxZ = Math.max(0, Math.min(navGrid.height - 1, Math.floor(region.maxZ)));

    // Defensive check for regions entirely outside grid bounds after clamping
    if (minX > maxX || minZ > maxZ) return;

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const surfaceY = NavGrid.computeSurfaceY(voxelGrid, x, z);
        const cellType = NavGrid.classifyCellType(x, z, voxelGrid, buildings, drillHoles, surfaceY);
        navGrid.cells[z]![x] = NavGrid.makeCell(cellType, NavGrid.computeBenchLevel(navGrid.maxSurfaceY, surfaceY));
      }
    }
  }

  /** True when a cell exists, is in bounds, and has finite moveCost (walkable/ramp/drill_hole). */
  private static isTraversableCell(navGrid: NavGrid, x: number, z: number): boolean {
    if (x < 0 || z < 0 || x >= navGrid.width || z >= navGrid.height) return false;
    const cell = navGrid.cells[z]?.[x];
    return !!cell && cell.type !== 'blocked' && cell.type !== 'void';
  }

  /**
   * Find the nearest traversable cell (walkable/ramp/drill_hole — anything
   * with finite moveCost) to (x, z), searching outward in expanding square
   * rings. Returns (x, z) unchanged when it is already traversable, or when
   * nothing traversable turns up within maxRadius.
   *
   * Distance-only: does not check that the cell found is actually path-
   * connected to anywhere else. A blast crater can carve isolated traversable
   * pockets walled off by 'void' on every side — nearest-by-distance can land
   * on one of those. Callers that need an actually reachable point should use
   * findNearestReachableCell instead.
   */
  static findNearestTraversableCell(
    navGrid: NavGrid,
    x: number,
    z: number,
    maxRadius: number = Math.max(navGrid.width, navGrid.height),
  ): { x: number; z: number } {
    if (NavGrid.isTraversableCell(navGrid, x, z)) return { x, z };

    for (let r = 1; r <= maxRadius; r++) {
      let best: { x: number; z: number } | null = null;
      let bestDistSq = Infinity;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // ring only
          const cx = x + dx;
          const cz = z + dz;
          if (!NavGrid.isTraversableCell(navGrid, cx, cz)) continue;
          const distSq = dx * dx + dz * dz;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            best = { x: cx, z: cz };
          }
        }
      }
      if (best) return best;
    }

    return { x, z };
  }

  /**
   * Find the nearest cell to (targetX, targetZ) that is actually 8-directionally
   * path-connected to (anchorX, anchorZ) — same adjacency Pathfinding.findPath
   * walks, so a cell this returns is guaranteed reachable from the anchor,
   * unlike findNearestTraversableCell's plain distance search.
   *
   * Exists because a spawn/destination point picked without checking the
   * NavGrid — e.g. a vehicle purchase or employee hire landing at the world's
   * geometric centre — can resolve to a blast-cleared 'void' column, or to an
   * isolated traversable pocket a blast crater walled off from the rest of the
   * map with no floor at all, which arrival-gated actions (#437) can never
   * actually path to even after nudging to the "nearest" traversable cell.
   *
   * anchorX/anchorZ should be a point known to sit in the map's main
   * connected region (callers typically use a world corner). Falls back to
   * (targetX, targetZ) unchanged if the anchor itself resolves to no
   * traversable cell, or if the connected component containing it is empty.
   */
  static findNearestReachableCell(
    navGrid: NavGrid,
    anchorX: number,
    anchorZ: number,
    targetX: number,
    targetZ: number,
  ): { x: number; z: number } {
    const anchor = NavGrid.findNearestTraversableCell(navGrid, anchorX, anchorZ);
    if (!NavGrid.isTraversableCell(navGrid, anchor.x, anchor.z)) return { x: targetX, z: targetZ };

    // 8-directional flood fill from the anchor — same adjacency A* uses —
    // over the whole grid. Grids here are small (dozens of tiles per side),
    // so an O(width*height) BFS per call is negligible.
    const reachable = NavGrid.floodFillReachable(navGrid, anchor.x, anchor.z);
    let best = anchor;
    let bestDistSq = (anchor.x - targetX) ** 2 + (anchor.z - targetZ) ** 2;

    for (const key of reachable) {
      const [xStr, zStr] = key.split(',');
      const x = Number(xStr);
      const z = Number(zStr);
      const distSq = (x - targetX) ** 2 + (z - targetZ) ** 2;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = { x, z };
      }
    }

    return best;
  }

  /**
   * Compute the set of all cells 8-directionally path-connected to
   * (anchorX, anchorZ) — same adjacency Pathfinding.findPath and
   * findNearestReachableCell walk. Returns cell keys in `"x,z"` format.
   *
   * Returns an empty set when the anchor cell itself is non-traversable
   * (no nudge to the nearest traversable cell, unlike findNearestReachableCell —
   * this is a raw reachability query from the exact anchor given).
   */
  static computeReachableSet(navGrid: NavGrid, anchorX: number, anchorZ: number): Set<string> {
    const ax = Math.round(anchorX);
    const az = Math.round(anchorZ);
    if (!NavGrid.isTraversableCell(navGrid, ax, az)) return new Set<string>();
    return NavGrid.floodFillReachable(navGrid, ax, az);
  }

  /**
   * 8-directional flood fill from (anchorX, anchorZ), assumed already
   * traversable. Shared by findNearestReachableCell and computeReachableSet
   * so both agree on every fixture.
   */
  private static floodFillReachable(navGrid: NavGrid, anchorX: number, anchorZ: number): Set<string> {
    const visited = new Set<string>();
    const queue: Array<{ x: number; z: number }> = [{ x: anchorX, z: anchorZ }];
    visited.add(`${anchorX},${anchorZ}`);

    for (let head = 0; head < queue.length; head++) {
      const { x, z } = queue[head]!;
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const nx = x + dx;
        const nz = z + dz;
        const key = `${nx},${nz}`;
        if (visited.has(key) || !NavGrid.isTraversableCell(navGrid, nx, nz)) continue;
        visited.add(key);
        queue.push({ x: nx, z: nz });
      }
    }

    return visited;
  }

  /**
   * Classify a single NavGrid cell based on column solidity, drill holes, buildings, and ramps.
   * Priority order (highest to lowest): void > drill_hole > blocked > ramp > walkable.
   *
   * Ramp detection: if any cardinal neighbor's surface Y differs from this cell's
   * surface Y by more than 1 voxel, the cell is classified as a ramp. This allows
   * pathfinding to handle elevation changes (e.g. stepped terrain or ramp transitions).
   */
  private static classifyCellType(
    x: number,
    z: number,
    voxelGrid: VoxelGrid,
    buildings: Building[],
    drillHoles: DrillHole[],
    surfaceY: number = NavGrid.computeSurfaceY(voxelGrid, x, z),
  ): NavCellType {
    // surfaceY is now passed in; fallback to computeSurfaceY if not provided
    if (surfaceY === -1) return 'void';
    if (drillHoles.some(h => Math.floor(h.x) === x && Math.floor(h.z) === z)) return 'drill_hole';
    if (buildings.some(b => isBuildingFootprintCell(b, x, z))) return 'blocked';
    // Ramp detection: cardinal neighbor with surface height delta > 1 voxel
    for (const [dx, dz] of CARDINAL_OFFSETS) {
      const neighborSurfaceY = NavGrid.computeSurfaceY(voxelGrid, x + dx, z + dz);
      if (neighborSurfaceY !== -1 && Math.abs(surfaceY - neighborSurfaceY) > 1) {
        return 'ramp';
      }
    }
    return 'walkable';
  }

  /**
   * Create a NavCell with the given type and appropriate move cost.
   */
  private static makeCell(type: NavCellType, benchLevel: number = 0): NavCell {
    let moveCost: number;
    switch (type) {
      case 'walkable': moveCost = 1.0; break;
      case 'ramp': moveCost = 1.8; break;
      case 'drill_hole': moveCost = 5.0; break;
      case 'blocked':
      case 'void': moveCost = Infinity; break;
      default: {
        const _exhaustive: never = type;
        void _exhaustive;
        moveCost = Infinity;
      }
    }
    return { type, moveCost, benchLevel, vehicleOccupied: false };
  }
}
