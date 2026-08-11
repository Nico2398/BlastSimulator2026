// BlastSimulator2026 — Task Dispatch engine
// Routes pending actions to qualified employees.

import type { GameState, PendingAction } from '../state/GameState.js';

export type { PendingAction };

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
  action: Omit<PendingAction, 'status' | 'assignedEmployeeId'>,
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
  state.pendingActions.push({ ...action, status: 'queued', assignedEmployeeId: null });
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
 * its ghost) stays in `state.pendingActions`/`state.ghostPreviews` — only its
 * status/assignedEmployeeId (and the ghost's `claimed` flag) change, so it
 * remains visible to the player while the employee walks to it (#547).
 * Returns the claimed action, or null if not found or already claimed.
 */
export function claimPendingAction(
  state: GameState,
  actionId: number,
  employeeId: number,
): PendingAction | null {
  const action = state.pendingActions.find(a => a.id === actionId);
  if (action === undefined || action.status !== 'queued') {
    return null;
  }
  action.status = 'assigned';
  action.assignedEmployeeId = employeeId;
  const ghost = state.ghostPreviews.find(g => g.id === actionId);
  if (ghost !== undefined) {
    ghost.claimed = true;
  }
  return action;
}

/**
 * Transition a claimed action from 'assigned' to 'in_progress' once the
 * assigned employee has arrived at the target (called from ArrivalGate).
 */
export function startPendingAction(state: GameState, actionId: number): void {
  const action = state.pendingActions.find(a => a.id === actionId);
  if (action !== undefined && action.status === 'assigned') {
    action.status = 'in_progress';
  }
}

/**
 * Remove a completed action and its ghost preview from state entirely
 * (called from events.ts and GameLoop rest-completion paths).
 */
export function completePendingAction(state: GameState, actionId: number): void {
  state.pendingActions = state.pendingActions.filter(a => a.id !== actionId);
  state.ghostPreviews = state.ghostPreviews.filter(g => g.id !== actionId);
}

