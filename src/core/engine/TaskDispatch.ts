// BlastSimulator2026 — Task Dispatch engine
// Routes pending actions to qualified employees.

import type { GameState, PendingAction } from '../state/GameState.js';
import { SURVEY_COSTS } from '../config/balance.js';
import type { SurveyMethod } from '../mining/SurveyCalc.js';
import { addIncome } from '../economy/Finance.js';
import type { Employee } from '../entities/Employee.js';
import { releaseVehicleReservation, releaseVehicleReservationKeepDriver } from './VehicleReservation.js';

export type { PendingAction };

/**
 * Clears the fields an employee's active-task claim sets, shared by
 * tickTaskProgress's completion path (GameLoop.ts) and cancelAction below —
 * both need the task/skill bookkeeping reset once an action stops occupying
 * the employee, whether it finished normally or was cancelled mid-flight.
 * cancelAction additionally clears walk/stuck fields on top of this, since
 * cancellation can happen while the employee is still walking to the target
 * (a lifecycle stage tickTaskProgress's completion path never sees).
 */
export function clearActiveTaskFields(emp: Employee): void {
  emp.activeActionId = null;
  emp.taskTicksRemaining = null;
  delete emp.activeTaskTotalTicks;
  emp.activeTaskSkill = null;
  emp.pendingActionType = null;
  emp.pendingActionPayload = null;
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
 * Distinguishes *why* dispatch rejected, beyond the generic `error: 'unqualified'`
 * kept for backward compatibility. Callers that need to phrase an accurate
 * rejection message (e.g. the console `dispatch` command, #406) should read
 * this instead of re-deriving the reason themselves:
 *  - 'target-not-found'    — targetEmployeeId does not match anyone on the roster.
 *  - 'target-unqualified'  — the targeted employee specifically lacks requiredSkill,
 *                            even if someone else on the roster holds it.
 *  - 'roster-unqualified'  — no targetEmployeeId was set, and nobody on the whole
 *                            roster holds requiredSkill.
 */
export type DispatchRejectionReason = 'target-not-found' | 'target-unqualified' | 'roster-unqualified';

/**
 * Dispatch a pending action to the game state.
 * Returns { success: false, error: 'unqualified', reason: ... } if no employee
 * on the roster has the required skill — see DispatchRejectionReason for what
 * `reason` distinguishes.
 *
 * When `action.targetEmployeeId` is set, the action can only ever be claimed by
 * that one employee (see tickEmployees' idleMatch in GameLoop.ts) — a roster-wide
 * "does anyone qualify" check is not sufficient in that case, since a *different*
 * qualified employee existing does nothing for an action only the target can
 * claim. Qualification is checked against the target specifically (#406).
 */
export function dispatchPendingAction(
  state: GameState,
  action: Omit<PendingAction, 'status' | 'holderId'>,
): { success: boolean; error?: string; reason?: DispatchRejectionReason } {
  const targetId = action.targetEmployeeId;
  const isQualified = (emp: { alive: boolean; qualifications: { category: string }[] }): boolean =>
    emp.alive && (action.requiredSkill === null
      || emp.qualifications.some(q => q.category === action.requiredSkill));

  if (targetId !== null && targetId !== undefined) {
    const target = state.employees.employees.find(emp => emp.id === targetId);
    if (target === undefined) {
      return { success: false, error: 'unqualified', reason: 'target-not-found' };
    }
    if (!isQualified(target)) {
      return { success: false, error: 'unqualified', reason: 'target-unqualified' };
    }
  } else if (!state.employees.employees.some(isQualified)) {
    return { success: false, error: 'unqualified', reason: 'roster-unqualified' };
  }
  // Full record constructed here — every dispatch starts life queued and
  // unheld (#547); callers no longer supply status/holderId themselves.
  state.pendingActions.push({ ...action, status: 'queued', holderId: null });
  state.ghostPreviews.push({
    id: action.id,
    type: action.type,
    targetX: action.targetX,
    targetZ: action.targetZ,
    targetY: action.targetY,
    claimed: false,
  });
  return { success: true };
}

/**
 * Claim a pending action by id, assigning it to `employeeId`. The action (and
 * its ghost) remain in `state.pendingActions`/`state.ghostPreviews` — only
 * status/holderId (and the ghost's `claimed` flag) change, so the record
 * stays visible while the employee walks to it (#547).
 *
 * Returns null (a no-op guard against double-claiming) when the action does
 * not exist, or its status is not 'queued' — an already-assigned/in_progress
 * action cannot be claimed a second time. Returns the mutated action on
 * success.
 */
export function claimPendingAction(
  state: GameState,
  actionId: number,
  employeeId: number,
): PendingAction | null {
  const action = state.pendingActions.find(a => a.id === actionId);
  if (!action || action.status !== 'queued') return null;

  action.status = 'assigned';
  action.holderId = employeeId;

  const ghost = state.ghostPreviews.find(g => g.id === actionId);
  if (ghost) ghost.claimed = true;

  return action;
}

/**
 * Remove a completed action and its ghost preview from state entirely.
 * Returns the completed action, or null if no action with that id existed —
 * a safe no-op, callable more than once for the same id.
 */
export function completePendingAction(
  state: GameState,
  actionId: number,
): PendingAction | null {
  const idx = state.pendingActions.findIndex(a => a.id === actionId);
  if (idx === -1) return null;
  const [action] = state.pendingActions.splice(idx, 1);

  const ghostIdx = state.ghostPreviews.findIndex(g => g.id === actionId);
  if (ghostIdx !== -1) state.ghostPreviews.splice(ghostIdx, 1);

  return action ?? null;
}

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
 * Order-time cost already charged for an action's type — survey today, 0 for
 * everything else. Used by cancelAction to compute the refund.
 */
function actionOrderCost(action: PendingAction): number {
  if (action.type !== 'survey') return 0;
  const method = action.payload['method'];
  if (typeof method !== 'string' || !(method in SURVEY_COSTS)) return 0;
  return SURVEY_COSTS[method as SurveyMethod];
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
      if (ghost) ghost.claimed = false;

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

