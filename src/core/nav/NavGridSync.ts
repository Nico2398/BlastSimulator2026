// BlastSimulator2026 — NavGridSync: wires NavGrid patching to `terrain:updated` (#1146)
//
// Replaces the scattered manual `patchNavGridForRegion`/`patchNavGrid` calls
// at every terrain-carve call site with a single subscription to the
// `terrain:updated` event every carve already emits. Wired once at the
// composition root instead of once per call site.

import type { EventEmitter } from '../state/EventEmitter.js';
import { NavGrid } from './NavGrid.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { Building } from '../entities/Building.js';
import type { DrillHole } from '../mining/DrillPlan.js';

/** The live objects a `terrain:updated` event needs to patch a NavGrid. */
export interface NavGridSyncTarget {
  navGrid: NavGrid;
  grid: VoxelGrid;
  buildings: Building[];
  drillHoles: DrillHole[];
}

/**
 * Subscribe `emitter`'s `terrain:updated` event to keep a NavGrid in sync.
 * Calls `getTarget()` fresh on every event (never caches) so it tracks a
 * mutable composition root. `getTarget` returns null when no live
 * navGrid+grid exist yet (pre-game) or either was torn down — the
 * subscription then no-ops for that event.
 */
export function subscribeNavGridToTerrainUpdates(
  emitter: EventEmitter,
  getTarget: () => NavGridSyncTarget | null,
): void {
  emitter.on('terrain:updated', ({ region }) => {
    const target = getTarget();
    if (!target) return;
    NavGrid.patchNavGrid(target.navGrid, target.grid, target.buildings, target.drillHoles, region);
  });
}
