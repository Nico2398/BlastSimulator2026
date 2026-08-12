// BlastSimulator2026 — Self-dispatching hauling action queue (#552)
//
// Turns hauling into a queued, self-dispatching action like the ones built
// for #547-#551: on-ground haulable fragments spawn haul_debris actions,
// oversized fragments spawn fragment_debris actions, and a qualified
// employee auto-claims/drives/loads/delivers them instead of hauling being
// reachable only through the manual Fleet-panel button.
//
// Skeleton only — bodies filled in by the implementer (#552).

import type { GameState, PendingAction } from '../state/GameState.js';

/** Payload carried by a haul_debris/fragment_debris PendingAction. */
export interface HaulActionPayload {
  fragmentId: number;
}

/**
 * Create one haul_debris/fragment_debris PendingAction per on-ground fragment
 * with no existing action (any status: queued/assigned/in_progress) already
 * covering its id. Idempotent — safe to call every tick. Oversized fragments
 * get fragment_debris instead of haul_debris.
 */
export function syncHaulDispatch(state: GameState): void {
  // TODO: implement
  void state;
}

/**
 * Claim-time eligibility gate. Pass-through (true) for any action that is not
 * haul_debris/fragment_debris. For haul_debris: true iff the fragment is
 * still on_ground and there is enough free storage room for its mass. For
 * fragment_debris: true iff the fragment is still on_ground and still
 * oversized.
 */
export function isHaulOrFragmentActionClaimable(state: GameState, action: PendingAction): boolean {
  // TODO: implement
  void state;
  void action;
  return true;
}
