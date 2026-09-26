// BlastSimulator2026 — Shared building-command helpers
// Relocated out of entities.ts (#556) so buildOrder.ts, entities.ts, and
// tickTaskCompletion.ts can share one copy instead of duplicating.
//
// The pure helpers now live in src/core/engine/BuildingTaskHelpers.ts
// (#1086), so the core-owned tick pipeline doesn't reach into src/console/
// for them. This file re-exports them unchanged and keeps the
// console-facing `siteBounds(ctx: GameContext)` wrapper so existing call
// sites (`siteBounds(ctx)`) need no edits.

import { siteBoundsForGrid, makeFootprintRegion } from '../../core/engine/BuildingTaskHelpers.js';
import type { GameContext } from './world.js';
import { regionForColumns } from '../../core/nav/NavGridSync.js';

export {
  makeFootprintRegion, levelBuildingFootprint,
  refreshLogisticsCapacity, relocateFootprintOccupants,
} from '../../core/engine/BuildingTaskHelpers.js';

/**
 * The site's live bounding box, as `placeBuilding`/`moveBuilding` want it.
 * Falls back to a 64 m square at the origin only when no grid exists — which
 * `requireGame` already rules out for every caller here.
 */
export function siteBounds(ctx: GameContext): { width: number; depth: number; originX: number; originZ: number } {
  return siteBoundsForGrid(ctx.grid ?? null);
}

/**
 * Emit `nav:occupancy_changed` for a building's footprint (destroy/upgrade/
 * move), no-op when no grid exists yet (pre-game). Shared by the three
 * buildCommand branches below that touch occupancy without carving voxels.
 */
export function emitFootprintOccupancyChanged(
  ctx: GameContext, x: number, z: number, sizeX: number, sizeZ: number,
): void {
  if (!ctx.grid) return;
  ctx.emitter.emit('nav:occupancy_changed', {
    region: regionForColumns(makeFootprintRegion(x, z, sizeX, sizeZ), ctx.grid),
  });
}
