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
import type { BlastRegion } from '../mining/BlastExecution.js';
import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { levelGroundRect } from '../mining/LevelGround.js';
import { DEFAULT_GRID_SIZE } from '../config/balance.js';
import { NavGrid } from '../nav/NavGrid.js';

/** The rectangular region a building/footprint of `sizeX`x`sizeZ` occupies, anchored at (x, z). */
export function makeFootprintRegion(x: number, z: number, sizeX: number, sizeZ: number): BlastRegion {
  return { minX: x, maxX: x + sizeX - 1, minZ: z, maxZ: z + sizeZ - 1 };
}

/**
 * Level a building's footprint at the end of construction, upgrade or move —
 * the carve-then-level idiom `TaskCompletionEffects.ts` and `entities.ts`'s
 * upgrade/move branches each call after mutating the building's own state.
 * Carves and derives the target height from the same true footprint region
 * (`makeFootprintRegion`) — the building's mesh is now centred on that exact
 * footprint (#1198), so there is no wider skirt to level separately.
 */
export function levelBuildingFootprint(
  grid: VoxelGrid,
  x: number,
  z: number,
  sizeX: number,
  sizeZ: number,
  emitter?: EventEmitter,
): ReturnType<typeof levelGroundRect> {
  return levelGroundRect(grid, makeFootprintRegion(x, z, sizeX, sizeZ), emitter);
}

/**
 * The site's live bounding box, as `placeBuilding`/`moveBuilding` want it.
 * Falls back to a 64 m square at the origin only when no grid exists.
 */
export function siteBoundsForGrid(grid: VoxelGrid | null): { width: number; depth: number; originX: number; originZ: number } {
  if (!grid) return { width: DEFAULT_GRID_SIZE, depth: DEFAULT_GRID_SIZE, originX: 0, originZ: 0 };
  return { width: grid.sizeX, depth: grid.sizeZ, originX: grid.minX, originZ: grid.minZ };
}

/** Re-derive logistics storage capacity from the current warehouse total. Call after any building mutation (build/destroy/upgrade/move). */
export function refreshLogisticsCapacity(state: GameState): void {
  syncLogisticsCapacity(state.logistics, getStorageCapacity(state.buildings));
}

/**
 * Move every alive employee standing inside `region` (a footprint's world
 * cells) to the nearest reachable free cell — called whenever a footprint
 * newly blocks routing: ordering, completing, upgrading or moving a
 * building (#1200).
 */
export function relocateFootprintOccupants(state: GameState, region: BlastRegion): void {
  if (!state.navGrid) return;
  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    const cx = Math.round(emp.x);
    const cz = Math.round(emp.z);
    if (cx < region.minX || cx > region.maxX || cz < region.minZ || cz > region.maxZ) continue;
    // avoidOccupancy: true — same fragment-/vehicle-occupancy rule foot
    // travel obeys (#954) gates the cell relocated onto, so this sweep
    // never "rescues" someone from a newly-blocked footprint straight into
    // another occupied cell. See NavGrid.findNearestReachableCell's doc.
    const nearest = NavGrid.findNearestReachableCell(state.navGrid, 0, 0, emp.x, emp.z, true);
    emp.x = nearest.x;
    emp.z = nearest.z;
  }
}
