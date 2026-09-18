// BlastSimulator2026 — NavGrid: 2D navigation surface derived from VoxelGrid
// Each cell represents walkability for A* pathfinding.
// Part of the navmesh system.

import {
  clampToGridColumn,
  computeVoxelColumnSurfaceHeight,
  computeVoxelColumnSurfaceY,
  type VoxelGrid,
} from '../world/VoxelGrid.js';
import type { Building } from '../entities/Building.js';
import type { DrillHole } from '../mining/DrillPlan.js';
import type { BlastRegion, FragmentData } from '../mining/BlastExecution.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { isVehicleCurrentlyDriving } from '../entities/Vehicle.js';
import type { Employee } from '../entities/Employee.js';
import { isBuildingFootprintCell } from '../entities/BuildingPlacement.js';
import { NAV_BENCH_HEIGHT, NAV_MAX_CLIMB_HEIGHT } from '../config/balance.js';
import * as reachability from './NavGridReachability.js';

/** Cardinal offsets for 4-directional neighbor checks. */
const CARDINAL_OFFSETS: readonly [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/**
 * True when stepping between two cells whose column heights sit at `fromY`
 * and `toY` is a physically negotiable climb (#953). Generic on its two
 * numbers — it does not know whether they are voxel indices or metres, so
 * every caller decides which quantity to feed it. Either side `undefined` —
 * hand-built test fixtures that don't model terrain height — is treated as
 * unconstrained.
 *
 * Production callers all pass `NavCell.climbY`, the integer topmost-solid-
 * voxel index, not the continuous `NavCell.surfaceY` marching-cubes crossing
 * (#1149). On this grid's 1m voxel pitch the two coincide only on
 * unmodified terrain — natural terrain has been graded into continuous
 * slopes since #1148, so two voxel-index-adjacent columns can read a
 * continuous `surfaceY` delta anywhere from just above 0 to just under 2
 * (see the doc comment above `NavGrid.classifyCellType`, which hit and fixed
 * the identical drift in ramp classification). Gating climb legality on that
 * continuous delta would let the exact same graded-terrain noise shift which
 * steps are legal near the `maxClimb` boundary, changing A*'s route choice
 * on ordinary flat terrain — the fractional-metres test cases below exercise
 * this function's own generic math, not what production feeds it.
 *
 * Lives here, next to the `NavCell` fields it reads, because three separate
 * layers apply the identical gate and must never drift apart:
 * `Pathfinding.findPath`'s neighbour expansion, `NavGridReachability`'s
 * climb-aware flood fill, and the reachable-set pre-filter
 * `ActionSelection.selectBestActionForEmployee` screens candidates with.
 */
export function isStepClimbable(fromY: number | undefined, toY: number | undefined, maxClimb: number): boolean {
  if (fromY === undefined || toY === undefined) return true;
  return Math.abs(fromY - toY) <= maxClimb;
}

export type NavCellType = 'walkable' | 'blocked' | 'drill_hole' | 'ramp' | 'void';

export interface NavCell {
  type: NavCellType;
  moveCost: number;
  benchLevel: number;
  /**
   * Per-cell vehicle-occupancy flag, checked by Pathfinding.findPath/
   * AgentMovement.isPathBlocked when a caller requests avoidVehicles.
   * tickVehicle/tickEmployeeMovement's own per-tick pathfinds both request
   * avoidVehicles:false and instead do vehicle-vs-vehicle collision avoidance
   * by comparing live x/z directly (see isCellOccupiedByOtherVehicle in
   * EntityMovementTick.ts) — this field plays no part in that. The
   * vehicle-occupancy-reroute escalation path (handleVehicleOccupancyBlock/
   * findPathAvoidingOtherVehicles in VehicleOccupancyReroute.ts, #591) still
   * sets it transiently the same way it always has. Since #954 it is also
   * maintained persistently by EntityMovementTick's per-vehicle tick (set
   * true on the vehicle's current cell while stationary, cleared when it
   * starts/finishes moving) and seeded by buildNavGrid, so it doubles as a
   * standing "a vehicle physically occupies this cell" flag that foot
   * pathfinding (avoidVehicles:true, employees) treats as impassable via
   * Pathfinding.isImpassable.
   */
  vehicleOccupied: boolean;
  /**
   * Count of on-ground fragments mapped to this cell. Absent/zero means no
   * fragment occupies the cell. Optional — like `surfaceY` — so hand-built
   * test fixtures that predate #954 keep compiling unmodified. Maintained
   * incrementally by addFragmentOccupant/removeFragmentOccupant as
   * fragments are created/hauled/broken; never recomputed by a full navgrid
   * rebuild.
   */
  fragmentOccupancy?: number;
  /**
   * Column's surface height, in metres, at classification time — the
   * continuous 0.5 marching-cubes crossing (VoxelGrid.
   * computeVoxelColumnSurfaceHeight), the same value the terrain mesh
   * renders, not the integer topmost-solid-voxel index (#1149). Populated
   * only by buildNavGrid/patchNavGrid; undefined for hand-built test
   * fixtures that don't model terrain height (#953).
   */
  surfaceY?: number;
  /**
   * Column's topmost-solid-voxel index (VoxelGrid.computeVoxelColumnSurfaceY)
   * at classification time — the same integer `classifyCellType`'s ramp
   * delta already uses, kept alongside the continuous `surfaceY` so
   * `isStepClimbable` can gate climb legality on it too (#1149). Populated
   * only by buildNavGrid/patchNavGrid; undefined for hand-built test
   * fixtures that don't model terrain height, same as `surfaceY` (#953).
   */
  climbY?: number;
}

/**
 * True when `cell` is currently vehicle- or fragment-occupied (#954) — the
 * single shared definition of "occupied", consolidated here after the exact
 * same `cell.vehicleOccupied || (cell.fragmentOccupancy ?? 0) > 0` expression
 * had been written three times independently: Pathfinding.ts's isImpassable,
 * NavGridReachability.ts's isOccupiedCell, and EntityMovementTick.ts's
 * isDestinationOccupied. Takes the cell directly rather than a NavGrid plus
 * coordinates so it stays usable from NavGridReachability.ts, which never
 * imports GameState (dev-architecture layering) — every call site already
 * holds or can cheaply resolve its own cell reference. `undefined` (an
 * out-of-bounds or not-yet-built cell) is never occupied.
 */
export function isCellOccupied(cell: NavCell | undefined): boolean {
  return !!cell && (cell.vehicleOccupied || (cell.fragmentOccupancy ?? 0) > 0);
}

export class NavGrid {
  readonly width: number;
  readonly height: number;
  /**
   * World x of cell column 0. Non-zero once the site has been claimed
   * westward (#473 D7) — the navgrid covers the voxel grid's live bounding
   * box, which no longer has to start at the origin.
   */
  readonly originX: number;
  /** World z of cell row 0. See `originX`. */
  readonly originZ: number;
  /** Not readonly: patchNavGrid corrects this in place when a patch lowers the grid's tallest column. */
  maxSurfaceY: number;
  /**
   * Grid-wide maximum of `NavCell.climbY` — the integer counterpart to
   * `maxSurfaceY`, kept alongside it so `computeBenchLevel` can gate bench
   * assignment on the integer-indexed height, the same parity fix
   * `classifyCellType` and `isStepClimbable` already apply (#1149). Defaults
   * to `maxSurfaceY` when not given, so every pre-existing positional
   * `new NavGrid(...)` call in this file's tests — none of which model a
   * real voxel grid — keeps its already-integer height as both.
   */
  maxClimbY: number;
  /**
   * Cells indexed **locally**: `cells[z - originZ][x - originX]`. Prefer
   * `cellAt`, which takes world coordinates, over indexing this directly.
   */
  readonly cells: NavCell[][];

  constructor(
    width: number,
    height: number,
    cells: NavCell[][],
    maxSurfaceY: number = 0,
    originX: number = 0,
    originZ: number = 0,
    maxClimbY: number = maxSurfaceY,
  ) {
    this.width = width;
    this.height = height;
    this.originX = originX;
    this.originZ = originZ;
    this.maxSurfaceY = maxSurfaceY;
    this.maxClimbY = maxClimbY;
    this.cells = cells;
  }

  /** East edge of the covered box, exclusive. */
  get maxX(): number { return this.originX + this.width; }
  /** South edge of the covered box, exclusive. */
  get maxZ(): number { return this.originZ + this.height; }

  /** True when world (x, z) falls inside the covered box. */
  containsCell(x: number, z: number): boolean {
    return x >= this.originX && x < this.maxX && z >= this.originZ && z < this.maxZ;
  }

  /** The cell at world (x, z), or undefined outside the covered box. */
  cellAt(x: number, z: number): NavCell | undefined {
    return this.cells[z - this.originZ]?.[x - this.originX];
  }

  /** Overwrite the cell at world (x, z). No-op outside the covered box. */
  setCellAt(x: number, z: number, cell: NavCell): void {
    const row = this.cells[z - this.originZ];
    if (row && x >= this.originX && x < this.maxX) row[x - this.originX] = cell;
  }

  /**
   * Mark that an on-ground fragment now occupies world (x, z), incrementing
   * the cell's fragmentOccupancy in place (#954). No-op outside the covered
   * box.
   */
  addFragmentOccupant(x: number, z: number): void {
    const cell = this.cellAt(x, z);
    if (!cell) return;
    cell.fragmentOccupancy = (cell.fragmentOccupancy ?? 0) + 1;
  }

  /**
   * Mark that an on-ground fragment no longer occupies world (x, z),
   * decrementing the cell's fragmentOccupancy in place (#954). No-op outside
   * the covered box.
   */
  removeFragmentOccupant(x: number, z: number): void {
    const cell = this.cellAt(x, z);
    if (!cell) return;
    cell.fragmentOccupancy = Math.max(0, (cell.fragmentOccupancy ?? 0) - 1);
  }

  /** Clamp world x into the covered box. */
  clampX(x: number): number {
    return Math.max(this.originX, Math.min(this.maxX - 1, Math.round(x)));
  }

  /** Clamp world z into the covered box. */
  clampZ(z: number): number {
    return Math.max(this.originZ, Math.min(this.maxZ - 1, Math.round(z)));
  }

  /**
   * Column surface height in column (x, z), in continuous metres — the same
   * 0.5 marching-cubes crossing the terrain mesh renders
   * (computeVoxelColumnSurfaceHeight), not the rounded topmost-solid-voxel
   * index (#1149). Returns -1 if the column is entirely void (no solid
   * voxel with density >= 0.5). Out-of-bounds (x, z) coordinates are
   * clamped to the grid limits.
   */
  static computeSurfaceY(voxelGrid: VoxelGrid, x: number, z: number): number {
    const { cx, cz } = clampToGridColumn(voxelGrid, x, z);
    return NavGrid.surfaceHeightFromVoxelY(voxelGrid, cx, cz, computeVoxelColumnSurfaceY(voxelGrid, cx, cz));
  }

  /**
   * Shared tail of `computeSurfaceY`, taking the column's integer voxel-index
   * (from `computeVoxelColumnSurfaceY`) as a parameter instead of
   * recomputing it. `buildNavGrid`/`patchNavGrid` compute that index once per
   * column and pass it here AND to `classifyCellType`'s ramp-delta, so the
   * same column is no longer top-down scanned twice per cell (#1149).
   */
  private static surfaceHeightFromVoxelY(voxelGrid: VoxelGrid, cx: number, cz: number, voxelY: number): number {
    if (voxelY === -1) return -1;
    return computeVoxelColumnSurfaceHeight(voxelGrid, cx, cz);
  }

  /**
   * Compute the maximum surface Y across all columns in the voxel grid.
   * Returns -1 if the entire grid is void/empty.
   */
  static computeMaxSurfaceY(voxelGrid: VoxelGrid): number {
    let maxY = -1;
    for (let z = voxelGrid.minZ; z < voxelGrid.maxZ; z++) {
      for (let x = voxelGrid.minX; x < voxelGrid.maxX; x++) {
        const surfaceY = NavGrid.computeSurfaceY(voxelGrid, x, z);
        if (surfaceY > maxY) maxY = surfaceY;
      }
    }
    return maxY;
  }

  /**
   * Compute the maximum topmost-solid-voxel index across all columns in the
   * voxel grid — the integer counterpart to `computeMaxSurfaceY`, used by
   * `computeBenchLevel` (#1149). Returns -1 if the entire grid is void/empty.
   */
  static computeMaxVoxelY(voxelGrid: VoxelGrid): number {
    let maxY = -1;
    for (let z = voxelGrid.minZ; z < voxelGrid.maxZ; z++) {
      for (let x = voxelGrid.minX; x < voxelGrid.maxX; x++) {
        const voxelY = computeVoxelColumnSurfaceY(voxelGrid, x, z);
        if (voxelY > maxY) maxY = voxelY;
      }
    }
    return maxY;
  }

  /**
   * Compute the bench level for a cell given its topmost-solid-voxel index
   * and the grid-wide max of that same integer index — deliberately NOT the
   * continuous `surfaceY`/`maxSurfaceY` metres (#1149), for the identical
   * reason `classifyCellType`'s ramp delta and `isStepClimbable`'s climb
   * gate both read the integer index: natural terrain has been graded into
   * continuous slopes since #1148, so two voxel-index-adjacent columns can
   * read a continuous `surfaceY` delta anywhere from just above 0 to just
   * under 2. Flooring that continuous delta by `NAV_BENCH_HEIGHT` shifts
   * which side of a bench boundary a column falls on purely from grading
   * noise, corrupting the same-bench-level tie-break
   * `NavGridReachability.findNearestReachableCell` and the ramp-level
   * grouping `Pathfinding.findRampConnections` both key off `benchLevel` —
   * confirmed empirically: on generated terrain, ~18% of adjacent-column
   * pairs land on a different bench under the continuous computation than
   * under this integer one, none of them differing in voxel index. Returns
   * 0 if voxelY < 0 (void cell).
   */
  static computeBenchLevel(maxVoxelY: number, voxelY: number): number {
    if (voxelY < 0) return 0;
    return Math.floor((maxVoxelY - voxelY) / NAV_BENCH_HEIGHT);
  }

  /**
   * Build a full NavGrid from the voxel grid, buildings, and drill holes.
   * Each cell is classified as walkable, blocked, drill_hole, ramp, or void.
   *
   * `groundFragments` and `vehicles` seed the per-cell fragmentOccupancy/
   * vehicleOccupied counts at build time (#954); both default to empty so
   * existing callers are unaffected until wired up.
   */
  static buildNavGrid(
    voxelGrid: VoxelGrid,
    buildings: Building[],
    drillHoles: DrillHole[],
    groundFragments: FragmentData[] = [],
    vehicles: Vehicle[] = [],
    employees: Employee[] = [],
  ): NavGrid {
    const width = voxelGrid.sizeX;
    const height = voxelGrid.sizeZ;
    const originX = voxelGrid.minX;
    const originZ = voxelGrid.minZ;
    const cells: NavCell[][] = [];
    const maxSurfaceY = NavGrid.computeMaxSurfaceY(voxelGrid);
    const maxVoxelY = NavGrid.computeMaxVoxelY(voxelGrid);

    for (let z = originZ; z < originZ + height; z++) {
      const row: NavCell[] = [];
      for (let x = originX; x < originX + width; x++) {
        // A column inside the bounding box the site does not actually own —
        // the notch left when an L-shaped site's box is squared off — is
        // 'void': nothing walks there, and nothing meshes there either.
        if (!voxelGrid.containsColumn(x, z)) {
          row.push(NavGrid.makeCell('void', 0));
          continue;
        }
        const voxelY = computeVoxelColumnSurfaceY(voxelGrid, x, z);
        const surfaceY = NavGrid.surfaceHeightFromVoxelY(voxelGrid, x, z, voxelY);
        const cellType = NavGrid.classifyCellType(x, z, voxelGrid, buildings, drillHoles, surfaceY, voxelY);
        const benchLevel = NavGrid.computeBenchLevel(maxVoxelY, voxelY);
        row.push(NavGrid.makeCell(cellType, benchLevel, surfaceY, false, 0, voxelY));
      }
      cells.push(row);
    }

    const navGrid = new NavGrid(width, height, cells, maxSurfaceY, originX, originZ, maxVoxelY);

    for (const fragment of groundFragments) {
      navGrid.addFragmentOccupant(Math.round(fragment.position.x), Math.round(fragment.position.z));
    }
    for (const vehicle of vehicles) {
      if (isVehicleCurrentlyDriving(vehicle, employees)) continue;
      const cell = navGrid.cellAt(Math.round(vehicle.x), Math.round(vehicle.z));
      if (cell) cell.vehicleOccupied = true;
    }

    return navGrid;
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

    const minX = navGrid.clampX(Math.floor(region.minX));
    const maxX = navGrid.clampX(Math.floor(region.maxX));
    const minZ = navGrid.clampZ(Math.floor(region.minZ));
    const maxZ = navGrid.clampZ(Math.floor(region.maxZ));

    // Defensive check for regions entirely outside grid bounds after clamping
    if (minX > maxX || minZ > maxZ) return;

    // Excavation (blast/drill/ramp) only ever lowers terrain, so the grid-wide
    // maxSurfaceY/maxClimbY can only go stale if this patch contained the
    // column that WAS the tallest. A cell whose old benchLevel was 0 sat in
    // that top band under the old maxClimbY — cheap to check before
    // overwriting it below.
    let mayHaveLoweredThePeak = false;

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const oldCell = navGrid.cellAt(x, z)!;
        if (oldCell.benchLevel === 0) mayHaveLoweredThePeak = true;
        if (!voxelGrid.containsColumn(x, z)) {
          // Column no longer exists — nothing to carry forward.
          navGrid.setCellAt(x, z, NavGrid.makeCell('void', 0));
          continue;
        }
        const voxelY = computeVoxelColumnSurfaceY(voxelGrid, x, z);
        const surfaceY = NavGrid.surfaceHeightFromVoxelY(voxelGrid, x, z, voxelY);
        const cellType = NavGrid.classifyCellType(x, z, voxelGrid, buildings, drillHoles, surfaceY, voxelY);
        navGrid.setCellAt(
          x, z,
          NavGrid.makeCell(
            cellType,
            NavGrid.computeBenchLevel(navGrid.maxClimbY, voxelY),
            surfaceY,
            oldCell.vehicleOccupied,
            oldCell.fragmentOccupancy ?? 0,
            voxelY,
          ),
        );
      }
    }

    // Rare: only when the patch may have touched the grid's tallest column.
    // Cells outside the patch keep bench levels computed against the old
    // maxSurfaceY until their own next patch or a full rebuild touches them —
    // correcting maxSurfaceY itself is the load-bearing fix; a full grid-wide
    // bench-level rebuild on every patch would defeat the point of patching.
    if (mayHaveLoweredThePeak) {
      const freshMax = NavGrid.computeMaxSurfaceY(voxelGrid);
      if (freshMax !== navGrid.maxSurfaceY) {
        navGrid.maxSurfaceY = freshMax;
      }
      const freshMaxVoxelY = NavGrid.computeMaxVoxelY(voxelGrid);
      if (freshMaxVoxelY !== navGrid.maxClimbY) {
        navGrid.maxClimbY = freshMaxVoxelY;
      }
    }
  }

  /**
   * Find the nearest traversable cell (walkable/ramp/drill_hole) to (x, z).
   * See NavGridReachability.findNearestTraversableCell for the full doc —
   * distance-only, does not check path-connectivity.
   */
  static findNearestTraversableCell(
    navGrid: NavGrid,
    x: number,
    z: number,
    maxRadius: number = Math.max(navGrid.width, navGrid.height),
    avoidOccupancy: boolean = false,
  ): { x: number; z: number } {
    return reachability.findNearestTraversableCell(navGrid, x, z, maxRadius, avoidOccupancy);
  }

  /**
   * Find the nearest cell to (targetX, targetZ) actually path-connected to
   * (anchorX, anchorZ). See NavGridReachability.findNearestReachableCell
   * for the full doc, including the avoidOccupancy (#954 follow-up fix)
   * parameter entity-spawn placement passes true for.
   */
  static findNearestReachableCell(
    navGrid: NavGrid,
    anchorX: number,
    anchorZ: number,
    targetX: number,
    targetZ: number,
    avoidOccupancy: boolean = false,
  ): { x: number; z: number } {
    return reachability.findNearestReachableCell(navGrid, anchorX, anchorZ, targetX, targetZ, avoidOccupancy);
  }

  /**
   * Compute the set of all cells 8-directionally path-connected to
   * (anchorX, anchorZ). See NavGridReachability.computeReachableSet for the
   * full doc.
   */
  static computeReachableSet(navGrid: NavGrid, anchorX: number, anchorZ: number): reachability.ReachableSet {
    return reachability.computeReachableSet(navGrid, anchorX, anchorZ);
  }

  /**
   * `computeReachableSet` with findPath's own per-step climb gate applied.
   * See NavGridReachability.computeClimbReachableSet for the full doc.
   */
  static computeClimbReachableSet(navGrid: NavGrid, anchorX: number, anchorZ: number): reachability.ReachableSet {
    return reachability.computeClimbReachableSet(navGrid, anchorX, anchorZ);
  }

  /**
   * Nearest cell to (targetX, targetZ) inside the grid's largest
   * climb-connected region. See NavGridReachability.findNearestNavigableCell
   * for the full doc.
   */
  static findNearestNavigableCell(navGrid: NavGrid, targetX: number, targetZ: number): { x: number; z: number } {
    return reachability.findNearestNavigableCell(navGrid, targetX, targetZ);
  }

  /**
   * Classify a single NavGrid cell based on column solidity, drill holes, buildings, and ramps.
   * Priority order (highest to lowest): void > drill_hole > blocked > ramp > walkable.
   *
   * Ramp detection: if any cardinal neighbor's topmost-solid-voxel index
   * differs from this cell's by more than 1 voxel and at most
   * NAV_MAX_CLIMB_HEIGHT voxels, the cell is classified as a ramp. This
   * allows pathfinding to handle elevation changes (e.g. stepped terrain or
   * ramp transitions). A delta beyond NAV_MAX_CLIMB_HEIGHT (e.g. a blast
   * crater wall) does NOT classify as a ramp — it falls through to walkable,
   * and Pathfinding's per-step climb gate (#953) is what actually refuses
   * that illegal step, since a cell can be legitimately walkable from one
   * neighbor and illegally steep relative to another.
   *
   * Deliberately voxel-indexed (computeVoxelColumnSurfaceY), not the
   * continuous `surfaceY` metres (#1149) — "how many whole voxel steps
   * apart" is a genuinely integer, stepped concept, the same kind
   * `computeBenchLevel` already floors to a bench index. Natural terrain's
   * marching-cubes crossing height varies smoothly across a graded slope
   * (#1148), so two columns one voxel-index apart can read a continuous
   * delta anywhere from just above 0 to just under 2 depending on where each
   * column's own crossing falls — a plain `computeSurfaceY` delta spuriously
   * promotes an ordinary one-voxel walkable step to 'ramp' (moveCost 1.8)
   * whenever the local grade pushes that delta past 1, which perturbs A*'s
   * cost landscape enough to change which of several equal-length routes it
   * picks (confirmed live: a staffed site's auto-hauler driving straight
   * into a permanently parked vehicle it used to path around, stuck forever
   * — #1149 fixer). The continuous `surfaceY` stored on the cell is
   * untouched and still what `isStepClimbable` gates physical movement on.
   */
  private static classifyCellType(
    x: number,
    z: number,
    voxelGrid: VoxelGrid,
    buildings: Building[],
    drillHoles: DrillHole[],
    surfaceY: number = NavGrid.computeSurfaceY(voxelGrid, x, z),
    ownVoxelY: number = computeVoxelColumnSurfaceY(voxelGrid, x, z),
  ): NavCellType {
    // surfaceY and ownVoxelY are passed in by buildNavGrid/patchNavGrid,
    // which already scanned this column once; default recomputes them for
    // any other caller.
    if (surfaceY === -1) return 'void';
    if (drillHoles.some(h => Math.floor(h.x) === x && Math.floor(h.z) === z)) return 'drill_hole';
    if (buildings.some(b => isBuildingFootprintCell(b, x, z))) return 'blocked';
    // Ramp detection: cardinal neighbor with topmost-solid-voxel index delta > 1
    for (const [dx, dz] of CARDINAL_OFFSETS) {
      const neighborVoxelY = computeVoxelColumnSurfaceY(voxelGrid, x + dx, z + dz);
      if (neighborVoxelY !== -1) {
        const delta = Math.abs(ownVoxelY - neighborVoxelY);
        if (delta > 1 && delta <= NAV_MAX_CLIMB_HEIGHT) {
          return 'ramp';
        }
      }
    }
    return 'walkable';
  }

  /**
   * Create a NavCell with the given type and appropriate move cost.
   */
  private static makeCell(
    type: NavCellType,
    benchLevel: number = 0,
    surfaceY?: number,
    vehicleOccupied: boolean = false,
    fragmentOccupancy: number = 0,
    climbY?: number,
  ): NavCell {
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
    return {
      type, moveCost, benchLevel, vehicleOccupied, fragmentOccupancy,
      ...(surfaceY !== undefined && { surfaceY }),
      ...(climbY !== undefined && { climbY }),
    };
  }
}
