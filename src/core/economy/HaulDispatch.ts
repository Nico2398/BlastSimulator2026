// BlastSimulator2026 — Self-dispatching hauling action queue (#552)
//
// Turns hauling into a queued, self-dispatching action like the ones built
// for #547-#551: on-ground haulable fragments spawn haul_debris actions,
// oversized fragments spawn fragment_debris actions, and a qualified
// employee auto-claims/drives/loads/delivers them instead of hauling being
// reachable only through the manual Fleet-panel button.

import type { GameState, PendingAction } from '../state/GameState.js';
import { isOversized } from '../mining/BlastCalc.js';

/** Payload carried by a haul_debris/fragment_debris PendingAction. */
export interface HaulActionPayload {
  fragmentId: number;
}

/**
 * Create one haul_debris/fragment_debris PendingAction per on-ground fragment
 * with no existing action (any status: queued/assigned/in_progress) already
 * covering its id. Idempotent — safe to call every tick. Oversized fragments
 * get fragment_debris instead of haul_debris.
 *
 * requiredSkill is deliberately left null on both action types — the actual
 * qualification a haul/break vehicle needs (the truck/excavator licence
 * ROLE_LICENCE_REQUIRED maps each role to) is enforced at claim time via
 * requiredVehicleRole/findVehicleForClaim (VehicleReservation.ts), not via
 * requiredSkill. Leaving requiredSkill null keeps tickEmployees' roster-wide
 * "does anyone qualify" check from ever flagging these unqualified (which
 * would auto-pause the game with an unqualified_task_error event) — a fresh
 * site with no hauler or no licensed driver yet must let the action sit
 * queued silently instead.
 */
export function syncHaulDispatch(state: GameState): void {
  const coveredFragmentIds = new Set<number>();
  for (const action of state.pendingActions) {
    if (action.type !== 'haul_debris' && action.type !== 'fragment_debris') continue;
    const fragmentId = action.payload['fragmentId'];
    if (typeof fragmentId === 'number') coveredFragmentIds.add(fragmentId);
  }

  for (const tracked of state.logistics.fragments) {
    if (tracked.state !== 'on_ground') continue;
    if (coveredFragmentIds.has(tracked.fragment.id)) continue;

    const oversized = isOversized(tracked.fragment.volume);
    const actionId = state.nextPendingActionId++;
    const targetX = Math.round(tracked.fragment.position.x);
    const targetZ = Math.round(tracked.fragment.position.z);

    const action: PendingAction = {
      id: actionId,
      type: oversized ? 'fragment_debris' : 'haul_debris',
      requiredSkill: null,
      requiredVehicleRole: oversized ? 'rock_fragmenter' : 'debris_hauler',
      targetX,
      targetZ,
      targetY: 0,
      payload: { fragmentId: tracked.fragment.id } satisfies HaulActionPayload,
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
    };

    // Pushed directly (bypassing dispatchPendingAction's "does anyone
    // qualify" gate, TaskDispatch.ts) — these must be able to sit queued
    // silently with no hauler/driver/depot available yet and pick up later
    // once the situation changes, never rejected outright.
    state.pendingActions.push(action);
    state.ghostPreviews.push({
      id: actionId,
      type: action.type,
      targetX,
      targetZ,
      targetY: 0,
      claimed: false,
    });

    coveredFragmentIds.add(tracked.fragment.id);
  }
}

/**
 * Claim-time eligibility gate. Pass-through (true) for any action that is not
 * haul_debris/fragment_debris. For haul_debris: true iff the fragment is
 * still on_ground and there is enough free storage room for its mass. For
 * fragment_debris: true iff the fragment is still on_ground and still
 * oversized.
 */
export function isHaulOrFragmentActionClaimable(state: GameState, action: PendingAction): boolean {
  if (action.type !== 'haul_debris' && action.type !== 'fragment_debris') return true;

  const fragmentId = action.payload['fragmentId'];
  const tracked = typeof fragmentId === 'number'
    ? state.logistics.fragments.find(f => f.fragment.id === fragmentId)
    : undefined;
  if (!tracked || tracked.state !== 'on_ground') return false;

  if (action.type === 'fragment_debris') {
    return isOversized(tracked.fragment.volume);
  }

  // haul_debris: a fragment heavier than the room left in storage can never
  // be delivered right now — claiming it would just send a hauler to load,
  // drive, and be turned away at the depot every tick (mirrors the same
  // room check findReachableGroundFragment/HaulingTask.ts already applies to
  // the manual Haul button's own candidate search).
  const roomKg = state.logistics.storageCapacityKg - state.logistics.storedMassKg;
  return tracked.fragment.mass <= roomKg;
}
