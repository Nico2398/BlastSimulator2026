// BlastSimulator2026 — Vehicle-continuity inline promotion (#550)
//
// Called by events.ts's completion pass the instant a vehicle-gated action
// finishes: keeps the driver mounted onto a same-role follow-up action
// instead of dismounting and re-walking, or releases the vehicle/completes
// the PendingAction when there is no follow-up (#552). Split out of
// GameLoop.ts as part of #759's file-size split; re-exported there so
// GameLoop.ts stays the single public surface for tick-orchestration callers.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import { completePendingAction, claimPendingAction, clearActiveTaskFields } from './TaskDispatch.js';
import { releaseVehicleOnCompletion } from './VehicleReservation.js';
import { isHaulOrFragmentActionClaimable } from '../economy/HaulDispatch.js';
import {
  isRampSegmentClaimable, selectBestActionForEmployee, findStarvedActionForEmployee, isQueuedActionAvailableToEmployee,
} from './ActionSelection.js';
import { promoteActionToActive, releaseUnboardedTaskQueueVehicleReservations } from './EmployeeDispatchSteps.js';

/**
 * Vehicle-continuity inline promotion (#550). Called by events.ts's
 * completion pass the instant a vehicle-gated action finishes, before it
 * would otherwise call VehicleReservation.releaseVehicleOnCompletion and
 * dismount the driver. Looks for a same-`requiredVehicleRole` follow-up
 * already available to `employee` — first their own `taskQueue` (claimed on
 * a prior tick), then the still-`queued` pool (open, or targeted at this
 * employee) — and, if one exists, transfers the just-finished action's
 * vehicle reservation straight to it and promotes it to active immediately,
 * so the employee stays mounted and drives to the next target the same tick
 * instead of dismounting and re-walking.
 *
 * Deliberately scoped to this one employee/vehicle pair: does not touch when
 * `tickEmployees` runs, or any other employee's completion-to-redispatch
 * timing. An earlier fix solved the same continuity gap by globally
 * reordering the tick's dispatch pass to run after completion instead of
 * before — that shifted survey/task completion timing by up to one tick for
 * every employee in the game, not just vehicle-gated ones (regression fixed
 * by restoring the original 8d-before-8e order and adding this function).
 *
 * The two candidate sources rank differently. `queuedFollowUps` (this
 * employee's own taskQueue) were already validated reachable when originally
 * claimed, so ties are broken by lowest action id, matching
 * claimActionsTargetedAtEmployee's own determinism rule. `poolFollowUps`
 * (the open `queued` pool) are fresh and never vetted for this employee, so
 * they go through selectBestActionForEmployee's reachability-checked cost
 * ranking instead — see that branch's own comment for why an id-sort there
 * regressed (#953).
 *
 * Returns true when a follow-up was promoted this way (caller must skip
 * releaseVehicleOnCompletion — the vehicle is now reserved for the new
 * action, not free). Returns false when nothing qualified — caller falls
 * back to the normal unconditional release/dismount.
 */
export function tryContinueVehicleGatedAction(
  state: GameState,
  employee: Employee,
  completedAction: PendingAction,
): boolean {
  const role = completedAction.requiredVehicleRole;
  if (role === null) return false;

  const vehicle = state.vehicles.vehicles.find(v => v.reservedForActionId === completedAction.id);
  if (!vehicle || vehicle.driverId !== employee.id) return false;

  const queuedFollowUps = employee.taskQueue
    .map(id => state.pendingActions.find(a => a.id === id))
    .filter((a): a is PendingAction =>
      a !== undefined && a.status === 'assigned' && a.holderId === employee.id && a.requiredVehicleRole === role
      // #552: re-checked here too — conditions (storage room, still
      // oversized) can drift between the original claim and this same-tick
      // continuity promotion.
      && isHaulOrFragmentActionClaimable(state, a)
      // #555: same continuity gap for a ramp segment — a follow-up out of
      // order (predecessor not yet done) is skipped, not grabbed early.
      && isRampSegmentClaimable(state, a))
    .sort((a, b) => a.id - b.id);

  if (queuedFollowUps.length > 0) {
    const followUp = queuedFollowUps[0]!;
    employee.taskQueue = employee.taskQueue.filter(id => id !== followUp.id);
    vehicle.reservedForActionId = followUp.id;
    promoteActionToActive(state, employee, followUp);
    return true;
  }

  const poolFollowUps = state.pendingActions
    .filter(a =>
      isQueuedActionAvailableToEmployee(employee, a) &&
      a.requiredVehicleRole === role &&
      // #552: see claimActionsTargetedAtEmployee's own comment on the same check.
      isHaulOrFragmentActionClaimable(state, a) &&
      // #555: see queuedFollowUps' own comment on the same check, just above.
      isRampSegmentClaimable(state, a));

  if (poolFollowUps.length === 0) return false;

  // Reachability-ranked (#959), unlike queuedFollowUps' plain id-sort just
  // above: these candidates are fresh from the open pool, never vetted for
  // this employee at all, where queuedFollowUps' were already validated
  // reachable when originally claimed. Picking the lowest id here — the
  // oldest-queued fragment, not the nearest one — could and did hand the
  // vehicle a target outside its climb-reachable region (a fresh blast's
  // walled-off interior, #953) with no recovery: the drive then freezes on
  // it (mitigated separately by EntityMovementTick.ts's sustained-stuck
  // release), gets released back to the pool, and this exact same unchecked
  // sort immediately hands back the same unreachable lowest-id candidate —
  // the vehicle never once reaches an actually-haulable fragment again.
  // selectBestActionForEmployee already carries the fix (#953's own
  // climb-reachable-set pre-filter plus a real findPath confirmation) that
  // claimOnePoolCandidate uses for the general idle-employee case; this
  // continuity fast path needs the exact same guard.
  const selection = selectBestActionForEmployee(state, employee, poolFollowUps);
  if (selection === null) return false;

  const followUp = selection.action;
  const claimed = claimPendingAction(state, followUp.id, employee.id);
  if (!claimed) return false;

  vehicle.reservedForActionId = claimed.id;
  promoteActionToActive(state, employee, claimed);
  return true;
}

/**
 * Shared completion path for any vehicle-gated action (#552): continuity-
 * promote a same-role follow-up action if one exists (mirrors
 * tryContinueVehicleGatedAction), else release the vehicle/dismount the
 * employee, then remove the PendingAction record and its ghost preview.
 *
 * Called from events.ts's tick pipeline once per entry in
 * ArrivalGate.tickArrivalGate's own `completedVehicleActions` — the haul/
 * break drive loop reports a full deliver/break cycle finishing there, since
 * a vehicle-gated haul_debris/fragment_debris action never runs through
 * tickTaskProgress's employee-timer completion path (its work is entirely
 * vehicle-position/phase-driven, not a counted-down employee task timer).
 */
export function completeVehicleGatedActionIfApplicable(state: GameState, emp: Employee, actionId: number): void {
  const action = state.pendingActions.find(a => a.id === actionId);
  if (!action || action.requiredVehicleRole === null) return;

  // #1000: a long-starved on-foot (requiredVehicleRole === null) action wins
  // over same-role vehicle continuity, so a deep haul/fragment backlog can
  // never permanently starve out an ordered building/survey/demolish that
  // nobody else is ever free to walk to. Checked before
  // tryContinueVehicleGatedAction so the override happens at the call site
  // that decides whether to invoke it, not inside it.
  const starved = findStarvedActionForEmployee(state, emp);
  if (starved !== null) {
    releaseVehicleOnCompletion(state, emp, actionId);
    releaseUnboardedTaskQueueVehicleReservations(state, emp);
    clearActiveTaskFields(emp);
    const claimed = claimPendingAction(state, starved.action.id, emp.id);
    if (claimed) {
      promoteActionToActive(state, emp, claimed);
    }
    completePendingAction(state, actionId);
    return;
  }

  const continued = tryContinueVehicleGatedAction(state, emp, action);
  if (!continued) {
    releaseVehicleOnCompletion(state, emp, actionId);
    // tryContinueVehicleGatedAction already reassigned activeActionId (and
    // every other task-claim field) to the follow-up when it succeeds — only
    // clear them here when there was no follow-up to continue onto, so this
    // employee falls back to normal idle dispatch next tick.
    clearActiveTaskFields(emp);
  }

  completePendingAction(state, actionId);
}
