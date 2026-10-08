/** Self-dispatched `repair_vehicle` orders for idle damaged vehicles. */
import type { GameState } from '../state/GameState.js';

/**
 * Idempotent: one `repair_vehicle` PendingAction per idle damaged vehicle,
 * stale ones pruned. Orders skip the qualification check so unqualified
 * ones sit queued with blockedReason 'no_qualified_employee'.
 */
export function syncRepairDispatch(_state: GameState): void {
  // TODO: implement
}
