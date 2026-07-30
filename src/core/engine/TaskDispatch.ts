// BlastSimulator2026 — Task Dispatch engine
// Routes pending actions to qualified employees.

import type { GameState, PendingAction } from '../state/GameState.js';

export type { PendingAction };

/**
 * Dispatch a pending action to the game state.
 * Returns { success: false, error: 'unqualified' } if no employee on the roster
 * has the required skill.
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
): { success: boolean; error?: string } {
  const targetId = action.targetEmployeeId;
  const isQualified = (emp: { alive: boolean; qualifications: { category: string }[] }): boolean =>
    emp.alive && (action.requiredSkill === null
      || emp.qualifications.some(q => q.category === action.requiredSkill));

  const hasQualified = targetId !== null && targetId !== undefined
    ? (() => {
        const target = state.employees.employees.find(emp => emp.id === targetId);
        return target !== undefined && isQualified(target);
      })()
    : state.employees.employees.some(isQualified);

  if (!hasQualified) {
    return { success: false, error: 'unqualified' };
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

