// BlastSimulator2026 — Debris the terrain strands, as against debris buried in its pile.
//
// Rubble blocks vehicles over each rock's footprint, so a pile is worked from its edge:
// the rock inside it reads debris_out_of_reach until the rock around it is hauled. That
// is the pile, not a stranding. What terrain alone strands — a crater with no way down,
// a pocket, a ledge — is what a decision about ramps or the next shot must weigh.
import { judgeQueuedOrders } from './OrderReachability.js';
import { isAutoDebrisAction } from '../economy/HaulDispatch.js';
import type { GameState, PendingAction } from '../state/GameState.js';

/**
 * Runs `read` with every fragment's nav-grid occupancy set aside, as if the rubble were gone but the terrain the
 * blast left were not. Leaves the nav grid exactly as it found it (its `fragmentRevision` moves on, so derived
 * caches rebuild).
 */
export function withRubbleSetAside<T>(state: GameState, read: () => T): T {
  const nav = state.navGrid;
  if (nav === null) return read();
  const cleared: Array<{ x: number; z: number; occupancy: number }> = [];
  for (let z = nav.originZ; z < nav.originZ + nav.height; z++) {
    for (let x = nav.originX; x < nav.originX + nav.width; x++) {
      const cell = nav.cellAt(x, z);
      const occupancy = cell?.fragmentOccupancy ?? 0;
      if (cell === undefined || occupancy <= 0) continue;
      cleared.push({ x, z, occupancy });
      cell.fragmentOccupancy = 0;
    }
  }
  nav.fragmentRevision++;
  try {
    return read();
  } finally {
    for (const { x, z, occupancy } of cleared) nav.cellAt(x, z)!.fragmentOccupancy = occupancy;
    nav.fragmentRevision++;
  }
}

/** Queued debris orders still out of reach with every fragment's occupancy set aside: the ones terrain strands. */
export function terrainStrandedDebris(state: GameState): PendingAction[] {
  return withRubbleSetAside(state, () => {
    const verdicts = judgeQueuedOrders(state);
    return state.pendingActions.filter(a => isAutoDebrisAction(a.type) && verdicts.get(a.id) === 'unreachable');
  });
}
