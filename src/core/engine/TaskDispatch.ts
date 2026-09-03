// BlastSimulator2026 — Task Dispatch engine
// Routes pending actions to qualified employees.

import type { GameState, PendingAction } from '../state/GameState.js';

export type { PendingAction };

export { clearActiveTaskFields, completePendingAction, completeIfOwnedRestAction } from './TaskLifecycleCore.js';
export { cancelAction, interruptActiveAction, releaseDeadEmployeeActions } from './TaskCancellation.js';
export type { CancelActionResult } from './TaskCancellation.js';

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
 * that one employee (see tickEmployees' idleMatch in EmployeeDispatchSteps.ts) — a roster-wide
 * "does anyone qualify" check is not sufficient in that case, since a *different*
 * qualified employee existing does nothing for an action only the target can
 * claim. Qualification is checked against the target specifically (#406).
 */
export function dispatchPendingAction(
  state: GameState,
  action: Omit<PendingAction, 'status' | 'holderId'>,
  options?: { skipQualificationCheck?: boolean },
): { success: boolean; error?: string; reason?: DispatchRejectionReason } {
  const targetId = action.targetEmployeeId;
  const isQualified = (emp: { alive: boolean; qualifications: { category: string }[] }): boolean =>
    emp.alive && (action.requiredSkill === null
      || emp.qualifications.some(q => q.category === action.requiredSkill));

  // skipQualificationCheck (#552): HaulDispatch.ts's syncHaulDispatch needs a
  // haul_debris/fragment_debris action to sit queued silently even when the
  // roster currently has nobody qualified (a fresh site with no hauler/driver
  // yet) — the actual qualification these action types need is enforced at
  // claim time via requiredVehicleRole/findVehicleForClaim instead, not here.
  if (!options?.skipQualificationCheck) {
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
  }
  // Full record constructed here — every dispatch starts life queued and
  // unheld (#547); callers no longer supply status/holderId themselves.
  state.pendingActions.push({ ...action, status: 'queued', holderId: null });
  // A `place_building` ghost carries its real footprint (#556) so the
  // renderer can draw the full site outline instead of a single point —
  // every other action type's ghost is unaffected, footprint stays undefined.
  const footprint = action.type === 'place_building'
    ? (action.payload['footprint'] as ReadonlyArray<readonly [number, number]> | undefined)
    : undefined;
  state.ghostPreviews.push({
    id: action.id,
    type: action.type,
    targetX: action.targetX,
    targetZ: action.targetZ,
    targetY: action.targetY,
    claimed: false,
    ...(footprint !== undefined ? { footprint } : {}),
  });
  state.ghostPreviewsRevision++;
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
  if (ghost) {
    ghost.claimed = true;
    state.ghostPreviewsRevision++;
  }

  return action;
}
