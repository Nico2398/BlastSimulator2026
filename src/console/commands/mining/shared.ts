// BlastSimulator2026 — Cross-family helpers shared by mining console commands

import type { GameState, PendingAction } from '../../../core/state/GameState.js';
import { cancelAction } from '../../../core/engine/TaskDispatch.js';
import type { MiningContext } from './types.js';

export function requireGame(ctx: MiningContext): string | null {
  if (!ctx.state || !ctx.grid) return 'No game loaded. Use new_game first.';
  return null;
}

/**
 * Resolve a user-supplied hole spec (`named['hole']`) to a canonical hole
 * id: the exact id if it already names a real hole, otherwise the legacy
 * `hole_N` fallback format. `includePlanned` controls whether an ordered-
 * but-not-yet-drilled hole counts as "real" for this purpose — drill_plan
 * remove and charge must see planned holes; sequence set and tubing install
 * must not, since they only ever act on an already-drilled hole (#634).
 */
export function resolveHoleId(
  state: GameState,
  holeSpec: string,
  includePlanned: boolean = true,
): string {
  const found = includePlanned
    ? (state.drillHoles.find(h => h.id === holeSpec) || state.plannedDrillHoles.find(h => h.id === holeSpec))
    : state.drillHoles.find(h => h.id === holeSpec);
  return found
    ? holeSpec
    : (holeSpec.startsWith('hole_') ? holeSpec : `hole_${holeSpec}`);
}

/**
 * Cancel the outstanding `charge_hole` PendingAction for `holeId`, if any
 * (#554, mirrors drill_hole's cancel-before-replace pattern). A no-op when
 * the hole has no order in flight.
 */
export function cancelOutstandingChargeAction(state: GameState, holeId: string): void {
  const action = state.pendingActions.find(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId);
  if (action) cancelAction(state, action.id);
}

/**
 * Removes a cancelled `drill_hole`/`charge_hole` action's own ghost from the
 * "ordered but not yet landed" pool it was tracked in (`plannedDrillHoles`/
 * `plannedChargesByHole`) — `cancelAction` (`TaskDispatch.ts`) only removes
 * the generic `PendingAction`/`ghostPreviews` record, deliberately staying
 * ignorant of mining-specific state so it can cancel any action type; the
 * planned-pool entry is this module's own bookkeeping and has to be cleared
 * here.
 *
 * `drillPlanCommand`'s `remove hole:<id>` and `clearDrillPlan` above already
 * call `cancelAction` immediately alongside their own splice/delete of the
 * matching planned entry, so they need nothing further. The gap this closes
 * is the *other* way a player cancels an order: the Operations panel's Work
 * Queue cancel button, which reaches `cancelAction` only through the generic
 * `employee cancel <id>` command (`employees.ts`) with no mining-specific
 * cleanup of its own — leaving a permanent, un-clearable ghost on the hole
 * (#554's code review, reproduced live: `orderedChargeCount`/
 * `plannedChargesByHole` still carried the cancelled hole after
 * `employee cancel <id>` reported success). The issue's own text is explicit
 * that cancelling a charge order removes its ghost; this generic path is
 * exactly where that promise broke, and — since `plannedDrillHoles` is
 * populated at order time the same way (#553) — the identical gap existed
 * for a cancelled drill order too.
 */
export function releasePlannedHoleForCancelledAction(state: GameState, action: PendingAction): void {
  // #555: a cancelled dig_ramp_segment keyed off rampId/segmentIndex, not
  // holeId — handled separately, same generic-cancel-path gap as
  // drill_hole/charge_hole above (the Operations panel's Work Queue cancel
  // button reaches only this hook, not buildRampCommand's own cancel path).
  if (action.type === 'dig_ramp_segment') {
    const rampId = action.payload['rampId'];
    if (typeof rampId !== 'number') return;
    const ramp = state.plannedRamps.find(r => r.id === rampId);
    if (!ramp) return;

    const segmentIndex = action.payload['segmentIndex'];
    const idx = ramp.segments.findIndex(s => s.index === segmentIndex);
    if (idx !== -1) ramp.segments.splice(idx, 1);

    if (!ramp.segments.some(s => !s.done)) {
      const rampIdx = state.plannedRamps.findIndex(r => r.id === rampId);
      if (rampIdx !== -1) state.plannedRamps.splice(rampIdx, 1);
    }
    return;
  }

  const holeId = action.payload['holeId'];
  if (typeof holeId !== 'string') return;

  if (action.type === 'drill_hole') {
    const idx = state.plannedDrillHoles.findIndex(h => h.id === holeId);
    if (idx !== -1) state.plannedDrillHoles.splice(idx, 1);
  } else if (action.type === 'charge_hole') {
    delete state.plannedChargesByHole[holeId];
  }
}
