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
 * hunger/fatigue forcing a rest — preempted it) back to the pool instead of
 * removing it (#549). Unlike cancelAction:
 *  - the record is NOT completed/removed — status returns to 'queued' and
 *    holderId/ghost.claimed clear, so any qualified employee (including this
 *    one again later) can reclaim it via tickEmployees/selectBestActionForEmployee;
 *  - targetEmployeeId is left exactly as it was — an open-pool action goes
 *    back to the open pool, a targeted one stays reserved for its target;
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
 */
export function interruptActiveAction(
  state: GameState,
  employee: Employee,
  actionId: number | null,
  options?: { keepVehicleDriver?: boolean },
): void {
  if (actionId !== null) {
    const action = state.pendingActions.find(a => a.id === actionId);
    if (action) {
      employee.interruptedActionPayload = action.payload;

      if (employee.taskTicksRemaining !== null && employee.taskTicksRemaining > 0) {
        action.payload = { ...action.payload, durationTicks: employee.taskTicksRemaining };
      }

      action.status = 'queued';
      action.holderId = null;

      const ghost = state.ghostPreviews.find(g => g.id === actionId);
      if (ghost) {
        ghost.claimed = false;
        state.ghostPreviewsRevision++;
      }

      // releaseVehicleReservation no-ops on its own when nothing is reserved
      // for this action id, so no need to gate the call on requiredVehicleRole.
      // options.keepVehicleDriver (#552) skips the dismount for the one
      // caller (ArrivalGate.ts's resolveBoarding) interrupting an action
      // whose driver had *just* boarded this same tick for it — every other
      // caller keeps the full dismount-and-idle release.
      if (options?.keepVehicleDriver) {
        releaseVehicleReservationKeepDriver(state, action.id);
      } else {
        releaseVehicleReservation(state, action.id);
      }
    }
  }

  clearHolderWalkFields(employee);
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
