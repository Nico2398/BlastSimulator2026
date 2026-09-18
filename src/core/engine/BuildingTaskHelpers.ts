// BlastSimulator2026 — Building-task core helpers (#1086)
//
// Core-owned relocation of the pure building/footprint/nav-patch helpers
// from src/console/commands/buildingHelpers.ts, so the core-owned tick
// pipeline (TickPipeline.ts) doesn't reach into src/console/ for them.
// `siteBoundsForGrid` narrows the original `siteBounds(ctx: GameContext)` to
// the one field it actually reads — the grid — since GameContext (a console
// concept) isn't available in core.

import { getStorageCapacity, getBuildingDef, getDefSize, type Building } from '../entities/Building.js';
import { syncLogisticsCapacity } from '../economy/Logistics.js';
import { NavGrid } from '../nav/NavGrid.js';
import type { BlastRegion } from '../mining/BlastExecution.js';
import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { EventEmitter, GameEventMap } from '../state/EventEmitter.js';
import { levelGroundRect } from '../mining/LevelGround.js';
import { DEFAULT_GRID_SIZE } from '../config/balance.js';

/** The rectangular region a building/footprint of `sizeX`x`sizeZ` occupies, anchored at (x, z). */
export function makeFootprintRegion(x: number, z: number, sizeX: number, sizeZ: number): BlastRegion {
  return { minX: x, maxX: x + sizeX - 1, minZ: z, maxZ: z + sizeZ - 1 };
}

/**
 * `makeFootprintRegion`'s region, widened by one column on the maxX/maxZ
 * sides only (minX/minZ identical) — the ground-carve region for a
 * building's footprint (#1144). A building's mesh spans one column further
 * on its high sides than the footprint's own occupancy cells, so carving
 * only `makeFootprintRegion` left that extra column unlevelled and the
 * building ramped toward it. NOT used for occupancy, NavGrid patching, or
 * placement checks — those keep using `makeFootprintRegion`.
 */
export function makeLevelFootprintRegion(x: number, z: number, sizeX: number, sizeZ: number): BlastRegion {
  return { minX: x, maxX: x + sizeX, minZ: z, maxZ: z + sizeZ };
}

/** True when (cx, cz) falls inside the true (unwidened) footprint of any building in `buildings`. */
function isInsideAnyFootprint(
  cx: number,
  cz: number,
  buildings: ReadonlyArray<Pick<Building, 'type' | 'tier' | 'x' | 'z'>>,
): boolean {
  for (const b of buildings) {
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(b.type, b.tier));
    if (cx >= b.x && cx <= b.x + sizeX - 1 && cz >= b.z && cz <= b.z + sizeZ - 1) return true;
  }
  return false;
}

/**
 * Level a building's footprint at the end of construction, upgrade or move —
 * the widen-carve-then-level idiom `TaskCompletionEffects.ts` and
 * `entities.ts`'s upgrade/move branches each built independently (#1144
 * review finding 2). Widens the carve to `makeLevelFootprintRegion` (a
 * building's mesh spans one column further than its occupancy footprint) but
 * derives the target height from the TRUE footprint only
 * (`makeFootprintRegion`, via `levelGroundRect`'s `targetRect` param) so a low
 * skirt column never drags the building's own pad down further than its
 * footprint requires.
 *
 * Guards the widened skirt against an ALREADY-STANDING neighbour (#1144
 * review finding 1): when two buildings are placed touching with zero gap,
 * a just-finished building's widened skirt column can land exactly on a
 * neighbour's own TRUE footprint. Any widened column that falls inside
 * another building's true footprint (per `buildings`) is skipped rather than
 * carved — carving it would silently lower an edge row of that neighbour's
 * own pad. `buildings` is passed as the plain data the check needs (not
 * `GameState`), so this stays callable from a console command that only
 * holds `state.buildings.buildings`.
 */
export function levelBuildingFootprint(
  grid: VoxelGrid,
  x: number,
  z: number,
  sizeX: number,
  sizeZ: number,
  buildings: ReadonlyArray<Pick<Building, 'type' | 'tier' | 'x' | 'z'>>,
  emitter?: EventEmitter,
): ReturnType<typeof levelGroundRect> {
  // `buildings` already carries this same building (place/upgrade/move all
  // land their own mutation before calling this) — its own TRUE footprint
  // origin is (x, z), the exact anchor this call levels, so it's excluded
  // here rather than being treated as "another building occupies this
  // column" and having its own footprint skipped from the carve.
  const others = buildings.filter(b => !(b.x === x && b.z === z));
  return levelGroundRect(
    grid,
    makeLevelFootprintRegion(x, z, sizeX, sizeZ),
    emitter,
    makeFootprintRegion(x, z, sizeX, sizeZ),
    (cx, cz) => isInsideAnyFootprint(cx, cz, others),
  );
}

/**
 * The site's live bounding box, as `placeBuilding`/`moveBuilding` want it.
 * Falls back to a 64 m square at the origin only when no grid exists.
 */
export function siteBoundsForGrid(grid: VoxelGrid | null): { width: number; depth: number; originX: number; originZ: number } {
  if (!grid) return { width: DEFAULT_GRID_SIZE, depth: DEFAULT_GRID_SIZE, originX: 0, originZ: 0 };
  return { width: grid.sizeX, depth: grid.sizeZ, originX: grid.minX, originZ: grid.minZ };
}

/** Patch the NavGrid for a region affected by a building mutation. */
export function patchNavGrid(state: GameState, grid: VoxelGrid, region: BlastRegion): void {
  if (state.navGrid) {
    NavGrid.patchNavGrid(state.navGrid, grid, state.buildings.buildings, state.drillHoles, region);
  }
}

/**
 * Widen a 2D `BlastRegion` (minX/maxX/minZ/maxZ, no height) to the full-height
 * region shape `terrain:updated`'s payload carries (adds minY/maxY spanning
 * `grid`'s whole height), for building carves that emit the event directly
 * instead of going through `LevelGround`/`Ramp`/`BlastExecution`.
 */
export function toFullHeightRegion(_region: BlastRegion, _grid: VoxelGrid): GameEventMap['terrain:updated']['region'] {
  // TODO: implement
  throw new Error('not implemented');
}

/** Re-derive logistics storage capacity from the current warehouse total. Call after any building mutation (build/destroy/upgrade/move). */
export function refreshLogisticsCapacity(state: GameState): void {
  syncLogisticsCapacity(state.logistics, getStorageCapacity(state.buildings));
}
