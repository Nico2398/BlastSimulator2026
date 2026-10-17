// BlastSimulator2026 — Saves from before in-place upgrades (#1875)
// An old upgrade was a Building Destroyer demolition plus a reserved rebuild site. Neither exists
// any more, so a load cancels what is still pending and refunds it in full; the standing
// building, if any, is left as it was.
// Removal point: delete this module and its call in SaveLoad.ts once saves that predate #1875 are
// no longer supported (no such save format can carry a `rebuild` site or `rebuildOrderId` payload).

import type { GameState } from './GameState.js';
import { cancelAction } from '../engine/TaskCancellation.js';
import { addIncome } from '../economy/Finance.js';

/** The pre-#1875 flag on a rebuild site; no longer part of PlannedBuilding. */
type LegacySite = { rebuild?: boolean };

/** Cancel every legacy upgrade demolition and orphaned rebuild site in `state`, refunding each in full. Idempotent. */
export function cancelLegacyUpgradeOrders(state: GameState): void {
  for (const action of [...state.pendingActions]) {
    if (action.type !== 'demolish_building') continue;
    const payload: unknown = action.payload;
    if (typeof payload !== 'object' || payload === null) continue;
    const orderId = (payload as Record<string, unknown>)['rebuildOrderId'];
    if (typeof orderId !== 'number') continue;
    cancelAction(state, action.id);
    const idx = state.plannedBuildings.findIndex(pb => pb.id === orderId);
    if (idx !== -1) state.plannedBuildings.splice(idx, 1);
  }

  for (const site of [...state.plannedBuildings]) {
    if ((site as LegacySite).rebuild !== true) continue;
    // A rebuild site can only fail or never finish, whether or not its building still stands: refund it.
    if (state.pendingActions.some(a => a.id === site.actionId)) {
      cancelAction(state, site.actionId);
    } else if (Number.isFinite(site.cost) && site.cost > 0) {
      state.cash += site.cost;
      addIncome(state.finances, site.cost, 'refund', `Upgrade cancelled: ${site.type} #${site.buildingId}`, state.tickCount);
    }
    const idx = state.plannedBuildings.findIndex(pb => pb.id === site.id);
    if (idx !== -1) state.plannedBuildings.splice(idx, 1);
  }
}
