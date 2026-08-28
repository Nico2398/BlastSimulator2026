// BlastSimulator2026 — Shared building-command helpers
// Relocated out of entities.ts (#556) so buildOrder.ts, entities.ts, and
// tickTaskCompletion.ts can share one copy instead of duplicating.

import { getStorageCapacity } from '../../core/entities/Building.js';
import { syncLogisticsCapacity } from '../../core/economy/Logistics.js';
import { NavGrid } from '../../core/nav/NavGrid.js';
import type { BlastRegion } from '../../core/mining/BlastExecution.js';
import type { GameState } from '../../core/state/GameState.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import type { GameContext } from './world.js';
import { DEFAULT_GRID_SIZE } from '../../core/config/balance.js';

/** The rectangular region a building/footprint of `sizeX`x`sizeZ` occupies, anchored at (x, z). */
export function makeFootprintRegion(x: number, z: number, sizeX: number, sizeZ: number): BlastRegion {
  return { minX: x, maxX: x + sizeX - 1, minZ: z, maxZ: z + sizeZ - 1 };
}

/**
 * The site's live bounding box, as `placeBuilding`/`moveBuilding` want it.
 * Falls back to a 64 m square at the origin only when no grid exists — which
 * `requireGame` already rules out for every caller here.
 */
export function siteBounds(ctx: GameContext): { width: number; depth: number; originX: number; originZ: number } {
  const grid = ctx.grid;
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
