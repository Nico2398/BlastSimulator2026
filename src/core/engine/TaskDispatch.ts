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

