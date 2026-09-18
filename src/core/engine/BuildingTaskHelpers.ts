// BlastSimulator2026 — Building-task core helpers (#1086)
//
// Core-owned relocation of the pure building/footprint/nav-patch helpers
// from src/console/commands/buildingHelpers.ts, so the core-owned tick
// pipeline (TickPipeline.ts) doesn't reach into src/console/ for them.
// `siteBoundsForGrid` narrows the original `siteBounds(ctx: GameContext)` to
// the one field it actually reads — the grid — since GameContext (a console
// concept) isn't available in core.

import { getStorageCapacity } from '../entities/Building.js';
import { syncLogisticsCapacity } from '../economy/Logistics.js';
import { NavGrid } from '../nav/NavGrid.js';
import type { BlastRegion } from '../mining/BlastExecution.js';
import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
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

/** Re-derive logistics storage capacity from the current warehouse total. Call after any building mutation (build/destroy/upgrade/move). */
export function refreshLogisticsCapacity(state: GameState): void {
  syncLogisticsCapacity(state.logistics, getStorageCapacity(state.buildings));
}
