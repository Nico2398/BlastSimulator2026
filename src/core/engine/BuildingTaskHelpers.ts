// BlastSimulator2026 — Building-task core helpers (#1086)
//
// Core-owned relocation of the pure building/footprint/nav-patch helpers
// from src/console/commands/buildingHelpers.ts, so the core-owned tick
// pipeline (TickPipeline.ts) doesn't reach into src/console/ for them.
// `siteBoundsForGrid` narrows the original `siteBounds(ctx: GameContext)` to
// the one field it actually reads — the grid — since GameContext (a console
// concept) isn't available in core.
//
// Skeleton only (#1086 skeleton phase) — no logic yet.

import type { BlastRegion } from '../mining/BlastExecution.js';
import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';

/** The rectangular region a building/footprint of `sizeX`x`sizeZ` occupies, anchored at (x, z). */
export function makeFootprintRegion(_x: number, _z: number, _sizeX: number, _sizeZ: number): BlastRegion {
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * The site's live bounding box, as `placeBuilding`/`moveBuilding` want it.
 * Falls back to a 64 m square at the origin only when no grid exists.
 */
export function siteBoundsForGrid(_grid: VoxelGrid | null): { width: number; depth: number; originX: number; originZ: number } {
  // TODO: implement
  throw new Error('not implemented');
}

/** Patch the NavGrid for a region affected by a building mutation. */
export function patchNavGrid(_state: GameState, _grid: VoxelGrid, _region: BlastRegion): void {
  // TODO: implement
  throw new Error('not implemented');
}

/** Re-derive logistics storage capacity from the current warehouse total. Call after any building mutation (build/destroy/upgrade/move). */
export function refreshLogisticsCapacity(_state: GameState): void {
  // TODO: implement
  throw new Error('not implemented');
}
