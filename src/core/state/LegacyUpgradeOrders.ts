// BlastSimulator2026 — Saves from before in-place upgrades (#1875)
// An old upgrade was a Building Destroyer demolition plus a reserved rebuild site. Neither exists
// any more, so a load cancels what is still pending and refunds it in full; the standing
// building, if any, is left as it was.

import type { GameState } from './GameState.js';
import { cancelAction } from '../engine/TaskCancellation.js';
import { addIncome } from '../economy/Finance.js';

/** The pre-#1875 flag on a rebuild site; no longer part of PlannedBuilding. */
type LegacySite = { rebuild?: boolean };

/** Cancel every legacy upgrade demolition and orphaned rebuild site in `state`, refunding each in full. Idempotent. */
export function cancelLegacyUpgradeOrders(state: GameState): void {
  for (const action of [...state.pendingActions]) {
    if (action.type !== 'demolish_building') continue;
    const orderId = action.payload['rebuildOrderId'];
    if (typeof orderId !== 'number') continue;
    cancelAction(state, action.id);
    const idx = state.plannedBuildings.findIndex(pb => pb.id === orderId);
    if (idx !== -1) state.plannedBuildings.splice(idx, 1);
  }

  for (const site of [...state.plannedBuildings]) {
    if ((site as LegacySite).rebuild !== true) continue;
    if (state.buildings.buildings.some(b => b.id === site.buildingId)) {
      delete (site as LegacySite).rebuild;
      continue;
    }
    // The building is gone: its rebuild can only fail or never finish, so it is refunded.
    if (state.pendingActions.some(a => a.id === site.actionId)) {
      cancelAction(state, site.actionId);
    } else {
      state.cash += site.cost;
      addIncome(state.finances, site.cost, 'refund', `Upgrade cancelled: ${site.type} #${site.buildingId}`, state.tickCount);
    }
    const idx = state.plannedBuildings.findIndex(pb => pb.id === site.id);
    if (idx !== -1) state.plannedBuildings.splice(idx, 1);
  }
}
