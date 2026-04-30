// BlastSimulator2026 — Task Dispatch engine
// Routes pending actions to qualified employees.

import type { GameState, PendingAction } from '../state/GameState.js';

export type { PendingAction };

/**
 * Dispatch a pending action to the game state.
 * Returns { success: false, error: 'unqualified' } if no employee on the roster
 * has the required skill.
 */
export function dispatchPendingAction(
  state: GameState,
  action: PendingAction,
): { success: boolean; error?: string } {
  const hasQualified = state.employees.employees.some(
    emp => emp.alive && emp.qualifications.some(q => q.category === action.requiredSkill),
  );
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

