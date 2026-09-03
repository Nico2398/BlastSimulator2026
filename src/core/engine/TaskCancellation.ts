// BlastSimulator2026 — Task cancellation/interruption
// Extracted from TaskDispatch.ts: player-initiated cancellation and
// needs-driven interruption of a PendingAction. Depends on
// TaskLifecycleCore.ts only — never on TaskDispatch.ts, to avoid a circular
// import.

import type { GameState, PendingAction } from '../state/GameState.js';
import { SURVEY_COSTS } from '../config/balance.js';
import type { SurveyMethod } from '../mining/SurveyCalc.js';
import { addIncome } from '../economy/Finance.js';
import type { Employee } from '../entities/Employee.js';
import { releaseVehicleReservation, releaseVehicleReservationKeepDriver } from './VehicleReservation.js';
import { clearActiveTaskFields, completePendingAction } from './TaskLifecycleCore.js';
import { octileHeuristic } from '../nav/Pathfinding.js';

export interface CancelActionResult {
  success: boolean;
  /** 'not-found' — no action with that id. 'not-cancellable' — engine-owned rest action. */
  error?: 'not-found' | 'not-cancellable';
  /** The removed action, present on success. */
  action?: PendingAction;
  /** Amount refunded to state.cash, 0 when the action's type charges nothing at order time. */
  refunded?: number;
}

/**
 * Cancel a PendingAction by id, at any lifecycle stage (queued, assigned, in_progress).
 * Rejects 'rest' actions — engine-owned, never player-cancellable (#548).
 *
 * When the action has a holder (an employee walking to or working it), the
 * employee is released back to idle — every field claimPendingAction/
 * tickEmployees set to claim/start it (activeActionId, walk destination,
 * in-progress task fields, move-stuck tracking) is cleared, so the employee
 * is claimable again next tick instead of stuck mid-walk or mid-task.
 *
 * Any order-time cost (survey only, today) is refunded to state.cash and
 * recorded on the finances ledger via addIncome — the same dual-write
 * (state.cash + finances ledger) pattern other cash-moving core functions
 * use, e.g. SurveyCalc.ts's runSurvey and EventResolver.ts.
 *
 * The action and its ghost are removed via completePendingAction, discarding
 * any in-progress work — a cancel produces no result and no XP.
 */
export function cancelAction(state: GameState, actionId: number): CancelActionResult {
  const action = state.pendingActions.find(a => a.id === actionId);
  if (!action) return { success: false, error: 'not-found' };
  if (action.type === 'rest') return { success: false, error: 'not-cancellable' };

  if (action.holderId !== null) {
    const holder = state.employees.employees.find(emp => emp.id === action.holderId);
    // #939: cancelAction must not clear a different, currently-active
    // action's bookkeeping when cancelling a queued-ahead reservation — see
    // holder.activeActionId check below (upcoming fix point).
    if (holder) clearHolderWalkFields(holder);
  }

  // releaseVehicleReservation no-ops on its own when nothing is reserved for
  // this action id, so no need to gate the call on requiredVehicleRole here.
  releaseVehicleReservation(state, action.id);

  const refunded = actionOrderCost(action);
  if (refunded > 0) {
    state.cash += refunded;
    addIncome(state.finances, refunded, 'refund', `Cancelled ${action.type} action`, state.tickCount);
  }

  completePendingAction(state, actionId);

  return { success: true, action, refunded };
}

/**
 * Release `employee`'s ONE active PendingAction (`actionId`, the value of
 * `employee.activeActionId` before a needs-driven interruption — collapse,
 * fatigue forcing a rest — preempted it) back to the pool instead of
 * removing it (#549). Unlike cancelAction:
 *  - the record is NOT completed/removed — status returns to 'queued' and
 *    holderId/ghost.claimed clear, so any qualified employee (including this
 *    one again later) can reclaim it via tickEmployees/selectBestActionForEmployee;
 *  - targetEmployeeId is left exactly as it was for a targeted action (stays
 *    reserved for its target) or for an open-pool action already arrived at
 *    its target (stays open-pool — work-in-progress is preserved via
 *    payload.durationTicks below instead, and any qualified employee can
 *    finish it from here). An open-pool action interrupted while still
 *    walking there is the one exception: it gets re-targeted at `employee`
 *    instead of releasing to the open pool — see this function's own doc
 *    comment further down for why;
 *  - the action's payload is preserved on `employee.interruptedActionPayload`
 *    before the walk/task-claim fields are cleared, mirroring the exact
 *    field-clearing cancelAction already does (clearHolderWalkFields) so the
 *    employee is claimable again next tick instead of stuck mid-walk/mid-task.
 *
 * No-op if `actionId` is null, or the action no longer exists in
 * `state.pendingActions` (already completed/removed) — the employee's walk/
 * task-claim fields are still cleared in that case, but interruptedActionPayload
 * is left unset since there is no payload left to preserve.
 *
 * Never used for 'rest' actions — collapse/need-routing rest actions
 * self-claim synchronously at creation (tickCollapse/tickNeedRestoration/
 * forceShiftRestIfNeeded) and are never the one being interrupted here; this
 * only ever preempts the work the employee was doing before the need crossed
 * its collapse threshold.
 *
 * Work already done is preserved rather than discarded: when the employee had
 * physically arrived and was counting down (`taskTicksRemaining` set — as
 * opposed to still walking there, which hasn't consumed any of the task's own
 * duration yet), the remaining tick count is written onto the action's own
 * `payload.durationTicks` — the same override `computeActionWorkTicks`
 * (ActionSelection.ts) already honors for a survey's method-specific
 * duration — so whichever employee reclaims this action later (the same one
 * post-rest, or, since an open-pool action's `targetEmployeeId` stays
 * whatever it was, potentially a different one) resumes it instead of
 * restarting its full work duration from scratch. Without this, a single
 * needs-driven interruption on a long task could silently double its total
 * completion time.
 *
 * Travel progress toward a not-yet-arrived open-pool action gets the same
 * "resume, don't restart" treatment, but by a different mechanism (#556
 * visual-testing follow-up): there is no work-in-progress tick count to stash
 * yet (`employee.taskTicksRemaining` is still null), but the employee is
 * already physically partway to the target, which no payload field can
 * capture — only THIS employee's own position reflects it. Leaving the
 * action fully open-pool (targetEmployeeId stays null) hands it to whichever
 * employee's dispatch turn (tickEmployees' ascending-id loop) next lands on
 * an idle slot — on a busy roster that is almost always a *different*,
 * still-at-base employee, since the interrupted one needs time to rest before
 * they're idle again. That employee restarts the whole walk from base, gets
 * interrupted at roughly the same distance, hands it to another base-camped
 * employee, and so on forever: confirmed live via #556's
 * building-placement-visual.json scenario, where a `place_building` order far
 * from the only living_quarters never completed after 600+ ticks of exactly
 * this relay, because the dispatch loop has no cross-employee cost comparison
 * — it hands a pool action to whichever employee is idle *first*, not
 * whichever is *closest*. Re-targeting the action at the interrupted employee
 * takes it out of that open-pool free-for-all: claimActionsTargetedAtEmployee
 * (step 1 of tickEmployees, exclusive and uncontested) reclaims it the
 * instant this employee is idle again, resuming the walk from wherever they
 * physically are instead of restarting it. Never applied to a 'rest' action
 * itself (self-claimed by its own creator, already targeted or immediately
 * reclaimed — see this function's own "never used for rest actions" note
 * above) or to a vehicle-gated action (`employee.pendingTaskDuration` is only
 * ever set by the non-vehicle branch of `promoteActionToActive`, so this
 * condition never matches one).
 *
 * options.forceOpenPool (#938): the one exception to the pin above. A caller
 * that already knows — before calling — that the destination is a sustained,
 * confirmed impasse rather than one that might still resolve (today, only
 * EntityMovementTick.ts's abandon-after-MOVE_STUCK_ABANDON_TICKS path) skips
 * the pin entirely, so the action is genuinely released to any qualified
 * employee instead of re-targeted at the one that just failed. Without this,
 * that caller's first interruption of a mid-walk claim hits the
 * `targetEmployeeId === null` branch below exactly like any other caller and
 * re-pins the action to the same employee, who then walks straight back into
 * the same unreachable destination and re-abandons ~30 ticks later — an
 * infinite cycle on a lean roster, where hasCloserIdleCandidate never finds a
 * strictly-closer idle candidate to trigger the softer release path. Every
 * other existing caller (ForceShiftRest.ts, ArrivalGate.ts, NeedRestoration.ts)
 * omits this option and keeps the pin's existing retry-same-employee semantics
 * unchanged — appropriate for their softer, first-strike interruptions of a
 * destination that may still resolve.
 */
/**
 * True when a different alive, uninjured, genuinely idle employee (not mid-
 * task, not mid-rest, not walking anywhere) is currently closer — by the same
 * cheap octile-distance estimate ActionSelection.ts's own estimateActionCost
 * ranks candidates with — to `action`'s target than `pinnedEmployee` is right
 * now. Used only to decide whether releasing a #556 walk-only pin (see
 * interruptActiveAction's own doc comment) is actually worth doing: a closer
 * idle employee could finish the remaining walk faster than the pinned one's
 * own repeatedly-interrupted crawl; with nobody closer, releasing would just
 * hand the action to "whichever employee is idle first" again with no
 * benefit — exactly the relay #556 fixed in the first place.
 */
function hasCloserIdleCandidate(state: GameState, pinnedEmployee: Employee, action: PendingAction): boolean {
  const ownDistance = octileHeuristic(pinnedEmployee.x, pinnedEmployee.z, action.targetX, action.targetZ);
  return state.employees.employees.some(other =>
    other.id !== pinnedEmployee.id
    && other.alive
    && !other.injured
    && other.activeActionId === null
    && other.restTicksRemaining === null
    && other.pendingDriverVehicleId === null
    && octileHeuristic(other.x, other.z, action.targetX, action.targetZ) < ownDistance,
  );
}

export function interruptActiveAction(
  state: GameState,
  employee: Employee,
  actionId: number | null,
  options?: { keepVehicleDriver?: boolean; forceOpenPool?: boolean },
): void {
  if (actionId !== null) {
    const action = state.pendingActions.find(a => a.id === actionId);
    if (action) {
      employee.interruptedActionPayload = action.payload;

      if (employee.taskTicksRemaining !== null && employee.taskTicksRemaining > 0) {
        action.payload = { ...action.payload, durationTicks: employee.taskTicksRemaining };
      } else if (
        action.type !== 'rest'
        && employee.pendingTaskDuration !== null
        && employee.taskTicksRemaining === null
      ) {
        // First mid-walk interruption of this action for this employee: pin
        // it to them (see this function's own doc comment / #556) so their
        // walk progress isn't discarded by a different, still-at-base
        // employee relaying it next tick. Marked with walkOnlyPinnedBy (in
        // payload, not just targetEmployeeId) specifically so this is
        // distinguishable from an action that arrived here ALREADY targeted
        // at this employee for an unrelated reason (a manual `employee
        // dispatch` order, say) — that kind of targeting is permanent by
        // design and must never be released; only a pin THIS branch itself
        // created is ever a candidate for release below.
        //
        // A REPEAT walk-only interruption of a pin THIS branch set —
        // walkOnlyPinnedBy already reads this employee's own id, meaning
        // they still haven't reached taskTicksRemaining even once since
        // being pinned — releases it (targetEmployeeId back to null,
        // genuinely open pool) ONLY when a different idle employee is
        // currently CLOSER to the target than this one (#867). Permanently
        // pinning regardless of distance is #556's own fix for a genuinely
        // worse problem — a target far from every employee relayed forever,
        // never once, because each new claimant restarted the walk from
        // base — confirmed by this exact reasoning still needing to hold for
        // building-placement-visual.json's own far-flung management_office
        // order, which a blind release-after-N-strikes broke by handing the
        // action to "whichever employee is idle first" again with no cross-
        // employee cost comparison, recreating the original relay. But under
        // three independent proactive-rest triggers instead of two (#867),
        // the pinned employee can ALSO end up too far from every rest
        // destination to ever land enough uninterrupted walk time — and if a
        // different, idle, well-rested employee is standing right at (or
        // much nearer) the target the whole time, permanent pinning locks
        // them out for no benefit: claimActionsTargetedAtEmployee (step 1)
        // reclaims the action for the pinned employee alone every tick,
        // before claimOnePoolCandidate (step 2) ever sees it as available to
        // anyone else. Confirmed live via tutorial-steps-visual.json's own
        // freight_warehouse order: pinned to one employee relaying between
        // distant rests, never released once in 2000+ ticks, while a second,
        // idle, well-rested employee stood at the site the whole time. The
        // octile-distance check below is the same cheap estimate
        // ActionSelection.ts's own estimateActionCost already uses to rank
        // candidates — real pathfinding is not needed just to decide whether
        // reassignment is even worth considering.
        //
        // options.forceOpenPool (#938) skips this pin entirely: a caller
        // that already knows the destination is a sustained, confirmed
        // impasse (EntityMovementTick.ts's abandon-after-30-stuck-ticks
        // path) rather than one that might still resolve gets the pin's
        // opposite — never create it on the first interruption, and always
        // release it on a repeat one, regardless of hasCloserIdleCandidate.
        // A pre-existing target this branch did NOT itself pin (permanent,
        // by-design targeting — a manual `employee dispatch` order) is left
        // alone either way; only a walkOnlyPinnedBy pin is ever a release
        // candidate, forced or not.
        if (action.targetEmployeeId === null) {
          if (!options?.forceOpenPool) {
            action.targetEmployeeId = employee.id;
            action.payload = { ...action.payload, walkOnlyPinnedBy: employee.id };
          }
        } else if (
          action.targetEmployeeId === employee.id
          && action.payload['walkOnlyPinnedBy'] === employee.id
          && (options?.forceOpenPool || hasCloserIdleCandidate(state, employee, action))
        ) {
          action.targetEmployeeId = null;
          const { walkOnlyPinnedBy: _unused, ...rest } = action.payload;
          action.payload = rest;
        }
      }

      // options.keepVehicleDriver (#552) skips the dismount for the one
      // caller (ArrivalGate.ts's resolveBoarding) interrupting an action
      // whose driver had *just* boarded this same tick for it — every other
      // caller keeps the full dismount-and-idle release.
      releaseActionToOpenPool(state, action, options);
    }
  }

  clearHolderWalkFields(employee);
}

/**
 * Shared "release one action back to the open pool" block: flips the action
 * to 'queued'/holderId:null, releases any vehicle reservation held for it
 * (releaseVehicleReservation no-ops on its own when nothing is reserved for
 * this action id, so no gate on requiredVehicleRole is needed), and
 * un-claims its ghost preview (bumping ghostPreviewsRevision). Used by
 * interruptActiveAction (above) and releaseDeadEmployeeActions (below) — each
 * keeps its own distinct surrounding logic and calls this only for the four
 * fields the two used to duplicate verbatim. Exported (#557 fix) for
 * EvacuationHold.ts's releaseInZoneTaskQueueEntries — a taskQueue entry an
 * evacuated employee claimed but never started walking to, with no
 * per-employee walk state of its own to unwind.
 *
 * options.keepVehicleDriver (#552): see interruptActiveAction's own call
 * site above — releaseDeadEmployeeActions never passes this, a dead
 * employee has no boarding-continuity case to protect.
 */
export function releaseActionToOpenPool(
  state: GameState,
  action: PendingAction,
  options?: { keepVehicleDriver?: boolean },
): void {
  action.status = 'queued';
  action.holderId = null;

  if (options?.keepVehicleDriver) {
    releaseVehicleReservationKeepDriver(state, action.id);
  } else {
    releaseVehicleReservation(state, action.id);
  }

  const ghost = state.ghostPreviews.find(g => g.id === action.id);
  if (ghost) {
    ghost.claimed = false;
    state.ghostPreviewsRevision++;
  }
}

/**
 * Clears every walk/task-claim field an active or in-flight claim sets on
 * `employee`, on top of clearActiveTaskFields — shared by cancelAction (which
 * then removes the action entirely) and interruptActiveAction (which returns
 * the action to the pool instead). Needed because cancellation/interruption
 * can happen while the employee is still walking to the target, a lifecycle
 * stage tickTaskProgress's normal-completion path never sees.
 */
function clearHolderWalkFields(emp: Employee): void {
  clearActiveTaskFields(emp);
  emp.destinationX = null;
  emp.destinationZ = null;
  emp.moveConsecutiveFailures = 0;
  emp.isMoveStuck = false;
  emp.pendingTaskDuration = null;
  emp.pendingDriverVehicleId = null;
}

/**
 * Order-time cost already charged for an action's type — survey today, 0 for
 * everything else. Used by cancelAction to compute the refund.
 */
function actionOrderCost(action: PendingAction): number {
  if (action.type === 'dig_ramp_segment') return (action.payload['segmentCost'] as number) ?? 0;
  // A building order is one atomic unit, not segmented like a ramp — the
  // FULL construction cost was charged at order time (buildOrder.ts) and is
  // refunded in full on cancellation (#556), unlike a ramp's per-segment cost.
  if (action.type === 'place_building') return (action.payload['cost'] as number) ?? 0;
  if (action.type !== 'survey') return 0;
  const method = action.payload['method'];
  if (typeof method !== 'string' || !(method in SURVEY_COSTS)) return 0;
  return SURVEY_COSTS[method as SurveyMethod];
}

/**
 * Releases every PendingAction still targeting or held by `employeeId` back
 * to the open pool — called once, right after that employee is confirmed
 * dead (killEmployee returns true). Without this, a death mid-claim orphans
 * the action forever: a personally-targeted one (targetEmployeeId ===
 * employeeId, still 'queued') can never be claimed by anyone else — only the
 * named target is allowed to (dispatchPendingAction's own targetId gate,
 * claimActionsTargetedAtEmployee's own filter) — and a held one ('assigned'/
 * 'in_progress', holderId === employeeId) is invisible to
 * claimOnePoolCandidate's pool query, which only ever looks at 'queued'
 * actions. Confirmed live: evacuateZone's own EVACUATION_HOLD_KEY relay
 * (Evacuation.ts) re-targets an interrupted, not-yet-started action back at
 * the employee it interrupted so THEY resume it once safe — but an employee
 * who is stranded (no reachable safe cell, Evacuation.ts's own documented
 * "silently stranded" case) and then dies in the very blast they couldn't
 * escape leaves that action permanently targeted at a corpse, stalling
 * whatever it was for (a management_office construction, say) forever
 * regardless of how many other qualified, living employees remain.
 *
 * Mirrors interruptActiveAction's own release shape (status -> 'queued',
 * holderId -> null, vehicle reservation released) but has no living Employee
 * to call clearHolderWalkFields on — the dead employee's own fields no
 * longer matter, only the action record does. A personally-targeted action
 * is opened to the whole pool (targetEmployeeId -> null) rather than left
 * targeted at nobody: the original target is gone, and whatever qualified
 * work this was is still worth finishing.
 */
export function releaseDeadEmployeeActions(state: GameState, employeeId: number): void {
  // A snapshot, not the live array: a 'rest' action below is removed via
  // completePendingAction, which splices state.pendingActions — iterating
  // the live array while splicing it skips whatever shifted into the
  // just-vacated index.
  for (const action of [...state.pendingActions]) {
    // 'rest' is always personal — never opened to the pool below, since
    // nobody else can rest on a dead employee's behalf. Their own body no
    // longer needs the sleep either, so the record (and its ghost) is
    // discarded outright rather than released, the same "not completed by an
    // employee, but the removal shape is the same" reasoning
    // completePendingAction's own doc comment already documents for a
    // superseded rest (tickCollapse, NeedRestoration.ts).
    if (action.type === 'rest' && (action.targetEmployeeId === employeeId || action.holderId === employeeId)) {
      completePendingAction(state, action.id);
      continue;
    }
    if (action.status === 'queued') {
      if (action.targetEmployeeId === employeeId) action.targetEmployeeId = null;
      continue;
    }
    if ((action.status === 'assigned' || action.status === 'in_progress') && action.holderId === employeeId) {
      if (action.targetEmployeeId === employeeId) action.targetEmployeeId = null;
      releaseActionToOpenPool(state, action);
    }
  }
}
