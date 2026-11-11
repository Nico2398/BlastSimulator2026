// Test helpers for the rule that rubble blocks the nav grid for every mover.
//
// A fragment occupies the cells it lies on (`NavGrid.addFragmentFootprint`), and a
// vehicle loads it from a free cell beside it, so a pile is worked from its edge: the
// rock inside it reads debris_out_of_reach until the rock around it is hauled. That is
// the pile, not a stranding. What terrain alone strands — a crater with no way down,
// a pocket, a pillar — is what a reachability claim about craters and ramps means.
import { judgeQueuedOrders } from '../../src/core/engine/OrderReachability.js';
import { isAutoDebrisAction } from '../../src/core/economy/HaulDispatch.js';
import type { GameState, PendingAction } from '../../src/core/state/GameState.js';

/**
 * Queued debris orders still out of reach with every fragment's occupancy set aside:
 * the ones terrain strands. Leaves the nav grid exactly as it found it.
 */
export function terrainStrandedDebris(state: GameState): PendingAction[] {
  const nav = state.navGrid;
  if (nav === null) return [];
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
    const verdicts = judgeQueuedOrders(state);
    return state.pendingActions.filter(a => isAutoDebrisAction(a.type) && verdicts.get(a.id) === 'unreachable');
  } finally {
    for (const { x, z, occupancy } of cleared) nav.cellAt(x, z)!.fragmentOccupancy = occupancy;
    nav.fragmentRevision++;
  }
}
