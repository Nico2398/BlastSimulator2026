// BlastSimulator2026 — Self-dispatching hauling action queue (#552)
//
// Turns hauling into a queued, self-dispatching action like the ones built
// for #547-#551: on-ground haulable fragments spawn haul_debris actions,
// oversized fragments spawn fragment_debris actions, and a qualified
// employee auto-claims/drives/loads/delivers them instead of hauling being
// reachable only through the manual Fleet-panel button.

import type { GameState, PendingAction } from '../state/GameState.js';
import { isOversized } from '../mining/BlastCalc.js';
import { dispatchPendingAction } from '../engine/TaskDispatch.js';
import type { TrackedFragment } from './Logistics.js';
import { fragmentHasOre } from '../mining/BlastOreReport.js';

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

    // Routed through dispatchPendingAction (shared with every other dispatch
    // path, e.g. SurveyCalc.ts's runSurvey) rather than a hand-built literal,
    // so PendingAction/GhostPreview construction stays in exactly one place.
    // skipQualificationCheck: true because these must be able to sit queued
    // silently with no hauler/driver/depot available yet and pick up later
    // once the situation changes, never rejected outright.
    dispatchPendingAction(state, {
      id: actionId,
      type: oversized ? 'fragment_debris' : 'haul_debris',
      requiredSkill: null,
      requiredVehicleRole: oversized ? 'rock_fragmenter' : 'debris_hauler',
      targetX,
      targetZ,
      targetY: 0,
      payload: { fragmentId: tracked.fragment.id } satisfies HaulActionPayload,
      targetEmployeeId: null,
    }, { skipQualificationCheck: true });

    coveredFragmentIds.add(tracked.fragment.id);
  }
}

/**
 * A fragment-by-id resolver scoped to one dispatch pass — see
 * `createFragmentLookup`.
 */
export type FragmentLookup = (fragmentId: number) => TrackedFragment | undefined;

/**
 * Build a lazy id → TrackedFragment index over `state.logistics.fragments`
 * for one dispatch pass.
 *
 * `logistics.fragments` is a plain array, so resolving an action's fragment
 * is a linear `find`. The claim-time gate calls it once per pool action, for
 * every idle employee, every tick — after a large blast that is
 * O(employees × actions × fragments) per tick, with actions ≈ fragments in
 * the thousands: `level1-lose-ecology.json` spent 126 of its 137 s in that
 * one `find`. Every caller that walks the pool builds this once and hands
 * it to the gate, so the pass is O(actions + fragments).
 *
 * The index is built on first use and is never kept past the pass that
 * created it — nothing here can go stale, because nothing that adds or
 * removes a fragment (`addBlastFragments`, `sellFragment`, a boulder split)
 * runs inside a claim pass, and a fragment's own `state` transitions mutate
 * the object the index holds. First occurrence wins, exactly like `find`.
 */
export function createFragmentLookup(state: GameState): FragmentLookup {
  let byId: Map<number, TrackedFragment> | null = null;
  return (fragmentId) => {
    if (byId === null) {
      byId = new Map();
      for (const tracked of state.logistics.fragments) {
        if (!byId.has(tracked.fragment.id)) byId.set(tracked.fragment.id, tracked);
      }
    }
    return byId.get(fragmentId);
  };
}

/**
 * Resolve the TrackedFragment a haul_debris/fragment_debris action's
 * payload.fragmentId refers to, or undefined when the payload carries no
 * numeric fragmentId or nothing in logistics.fragments matches it. Shared by
 * every consumer that needs to look up an action's fragment (claim-time
 * gating, ore-priority ranking) so the lookup lives in exactly one place.
 * A caller walking many actions passes the pass's `FragmentLookup`; a
 * one-off caller may omit it and pay the linear scan.
 */
function resolveTrackedFragment(
  state: GameState,
  action: PendingAction,
  lookup?: FragmentLookup,
): TrackedFragment | undefined {
  const fragmentId = action.payload['fragmentId'];
  if (typeof fragmentId !== 'number') return undefined;
  return lookup !== undefined
    ? lookup(fragmentId)
    : state.logistics.fragments.find(f => f.fragment.id === fragmentId);
}

/**
 * Claim-time eligibility gate. Pass-through (true) for any action that is not
 * haul_debris/fragment_debris. For fragment_debris: true iff the fragment is
 * still on_ground and still oversized. For haul_debris: true iff the
 * fragment is still on_ground and there is enough free storage room for its
 * mass, OR (#1091 — the paused-with-cargo resume case) the fragment is
 * `in_transit` and the vehicle carrying it is still reserved for this exact
 * action — a policy-driven interruption/pause leaves that reservation and
 * the loaded cargo intact instead of returning it to the ground
 * (`isCommittedToOwnCargo`, VehicleReservation.ts), so without this branch
 * the action would sit `queued` forever with no vehicle ever able to reclaim
 * it: the fragment reads `in_transit`, not `on_ground`, to every other
 * caller.
 */
export function isHaulOrFragmentActionClaimable(
  state: GameState,
  action: PendingAction,
  lookup?: FragmentLookup,
): boolean {
  if (action.type !== 'haul_debris' && action.type !== 'fragment_debris') return true;

  const tracked = resolveTrackedFragment(state, action, lookup);
  if (!tracked) return false;

  if (action.type === 'fragment_debris') {
    return tracked.state === 'on_ground' && isOversized(tracked.fragment.volume);
  }

  if (tracked.state === 'in_transit') {
    return state.vehicles.vehicles.some(
      v => v.reservedForActionId === action.id && v.payload?.fragmentId === tracked.fragment.id,
    );
  }

  if (tracked.state !== 'on_ground') return false;

  // A fragment heavier than the room left in storage can never be delivered
  // right now — claiming it would just send a hauler to load, drive, and be
  // turned away at the depot every tick (mirrors the same room check
  // findReachableGroundFragment/HaulingTask.ts already applies to the
  // manual Haul button's own candidate search).
  const roomKg = state.logistics.storageCapacityKg - state.logistics.storedMassKg;
  return tracked.fragment.mass <= roomKg;
}

/**
 * True iff `action` is haul_debris/fragment_debris and its referenced
 * fragment carries any ore (some oreDensities entry > 0). False for any
 * other action type or a fragment id that no longer resolves.
 */
export function haulActionCarriesOre(
  state: GameState,
  action: PendingAction,
  lookup?: FragmentLookup,
): boolean {
  if (action.type !== 'haul_debris' && action.type !== 'fragment_debris') return false;

  const tracked = resolveTrackedFragment(state, action, lookup);
  if (!tracked) return false;

  return fragmentHasOre(tracked.fragment.oreDensities);
}
