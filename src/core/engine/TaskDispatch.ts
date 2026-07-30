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
  action: PendingAction,
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
  state.pendingActions.push(action);
  state.ghostPreviews.push({
    id: action.id,
    type: action.type,
    targetX: action.targetX,
    targetZ: action.targetZ,
    targetY: action.targetY,
  });
  return { success: true };
}

/**
 * Claim a pending action by id — removes it from both `pendingActions` and
 * `ghostPreviews` and returns the action, or null if not found.
 */
export function claimPendingAction(
  state: GameState,
  actionId: number,
): PendingAction | null {
  const idx = state.pendingActions.findIndex(a => a.id === actionId);
  if (idx === -1) return null;
  const [claimed] = state.pendingActions.splice(idx, 1);
  const ghostIdx = state.ghostPreviews.findIndex(g => g.id === actionId);
  if (ghostIdx !== -1) state.ghostPreviews.splice(ghostIdx, 1);
  return claimed!;
}

