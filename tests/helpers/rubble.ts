// Test helpers for the rule that rubble blocks the nav grid for every mover.
//
// A fragment occupies the cells it lies on (`NavGrid.addFragmentFootprint`), and a
// vehicle loads it from a free cell beside it, so a pile is worked from its edge: the
// rock inside it reads debris_out_of_reach until the rock around it is hauled. That is
// the pile, not a stranding. What terrain alone strands — a crater with no way down,
// a pocket, a pillar — is what a reachability claim about craters and ramps means.
import { isAutoDebrisAction } from '../../src/core/economy/HaulDispatch.js';
import type { GameState } from '../../src/core/state/GameState.js';

export { terrainStrandedDebris, withRubbleSetAside } from '../../src/core/engine/TerrainStrandedDebris.js';

/**
 * Takes every on-ground fragment off the site with its nav-grid footprint, and drops the auto debris orders that
 * pointed at them: the site as if its rubble had been hauled, for tests about blast geometry rather than hauling
 * pace. Filtering `state.logistics.fragments` alone leaves the cells marked occupied, so vehicles stay walled out.
 */
export function clearRubble(state: GameState): void {
  for (const tracked of state.logistics.fragments) {
    if (tracked.state === 'on_ground') state.navGrid?.removeFragmentFootprint(tracked.fragment);
  }
  state.logistics.fragments = state.logistics.fragments.filter(f => f.state !== 'on_ground');
  state.pendingActions = state.pendingActions.filter(a => !isAutoDebrisAction(a.type));
}
