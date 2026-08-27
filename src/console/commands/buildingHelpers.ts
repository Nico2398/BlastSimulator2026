// BlastSimulator2026 — Shared building-command helpers
// Skeleton (#556): relocates makeFootprintRegion, siteBounds, patchNavGrid,
// and refreshLogisticsCapacity out of entities.ts so buildOrder.ts,
// entities.ts, and tickTaskCompletion.ts can share one copy. Bodies are
// moved here during the implementation phase — this file only pins the
// exported signatures so tests can import from it.

import type { BlastRegion } from '../../core/mining/BlastExecution.js';
import type { GameState } from '../../core/state/GameState.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import type { GameContext } from './world.js';

/** The rectangular region a building/footprint of `sizeX`x`sizeZ` occupies, anchored at (x, z). */
export function makeFootprintRegion(_x: number, _z: number, _sizeX: number, _sizeZ: number): BlastRegion {
  return undefined as unknown as BlastRegion;
}

/**
 * The site's live bounding box, as `placeBuilding`/`moveBuilding` want it.
 * Falls back to a 64 m square at the origin only when no grid exists — which
 * `requireGame` already rules out for every caller here.
 */
export function siteBounds(_ctx: GameContext): { width: number; depth: number; originX: number; originZ: number } {
  return undefined as unknown as { width: number; depth: number; originX: number; originZ: number };
}

/** Patch the NavGrid for a region affected by a building mutation. */
export function patchNavGrid(_state: GameState, _grid: VoxelGrid, _region: BlastRegion): void {
  // TODO: implement
}

/** Re-derive logistics storage capacity from the current warehouse total. Call after any building mutation (build/destroy/upgrade/move). */
export function refreshLogisticsCapacity(_state: GameState): void {
  // TODO: implement
}
