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
  return { success: true };
}
