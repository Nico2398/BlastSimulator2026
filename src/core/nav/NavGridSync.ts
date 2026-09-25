// BlastSimulator2026 — NavGridSync: wires NavGrid patching to `terrain:updated`
// and `nav:occupancy_changed` (#1146, #1161)
//
// Replaces the scattered manual `patchNavGridForRegion`/`patchNavGrid` calls
// at every terrain-carve call site with a single subscription to the
// `terrain:updated` event every carve already emits, plus `nav:occupancy_changed`
// for building-occupancy-only changes (destroy/upgrade/move/construction) that
// carve zero voxels. Splitting the two lets the renderer's `terrain:updated`-only
// remesh subscription in `src/main.ts` skip pure occupancy changes while NavGrid
// still patches on both. Wired once at the composition root instead of once per
// call site.

import type { EventEmitter, GameEventMap } from '../state/EventEmitter.js';
import { NavGrid } from './NavGrid.js';
import { computeColumnRangeY, type VoxelGrid } from '../world/VoxelGrid.js';
import type { Building } from '../entities/Building.js';
import type { DrillHole } from '../mining/DrillPlan.js';
import type { BlastRegion } from '../mining/BlastExecution.js';

/** The live objects a `terrain:updated` event needs to patch a NavGrid. */
export interface NavGridSyncTarget {
  navGrid: NavGrid;
  grid: VoxelGrid;
  buildings: Building[];
  drillHoles: DrillHole[];
}

/**
 * Widen a 2D `BlastRegion` (minX/maxX/minZ/maxZ, no height) to the
 * region shape `terrain:updated`'s payload carries, for building carves that
 * emit the event directly instead of going through
 * `LevelGround`/`Ramp`/`BlastExecution`. The vertical span comes from the
 * real ground under `footprint`'s columns (`computeColumnRangeY`), not a
 * full-grid `0..sizeY-1` guess — the grid has no vertical cap (#1185).
 * Falls back to `{ minY: 0, maxY: 0 }` when the rect has no ground anywhere.
 */
export function regionForColumns(footprint: BlastRegion, grid: VoxelGrid): GameEventMap['terrain:updated']['region'] {
  const range = computeColumnRangeY(grid, footprint.minX, footprint.maxX, footprint.minZ, footprint.maxZ);
  return {
    minX: footprint.minX, maxX: footprint.maxX,
    minZ: footprint.minZ, maxZ: footprint.maxZ,
    minY: range ? range.minY : 0, maxY: range ? range.maxY : 0,
  };
}

/**
 * Subscribe `emitter`'s `terrain:updated` (real voxel carves) and
 * `nav:occupancy_changed` (occupancy-only changes that carve zero voxels)
 * events to keep a NavGrid in sync. Both events share the same region
 * payload shape, and both drive the same patch logic. Calls `getTarget()`
 * fresh on every event (never caches) so it tracks a mutable composition
 * root. `getTarget` returns null when no live navGrid+grid exist yet
 * (pre-game) or either was torn down — the subscription then no-ops for
 * that event.
 */
export function subscribeNavGridToUpdates(
  emitter: EventEmitter,
  getTarget: () => NavGridSyncTarget | null,
): void {
  const patchRegion = (region: GameEventMap['terrain:updated']['region']): void => {
    const target = getTarget();
    if (!target) return;
    NavGrid.patchNavGrid(target.navGrid, target.grid, target.buildings, target.drillHoles, region);
  };
  emitter.on('terrain:updated', ({ region }) => patchRegion(region));
  emitter.on('nav:occupancy_changed', ({ region }) => patchRegion(region));
}
