// BlastSimulator2026 — Task lifecycle core
// Leaf module extracted from TaskDispatch.ts: clears the active-task
// bookkeeping fields an employee's claim sets, and removes a completed
// PendingAction (plus its ghost preview) from state. No dependency on
// TaskCancellation.ts — that file depends on this one, never the reverse,
// so the split introduces no circular import.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';

/**
 * Clears the fields an employee's active-task claim sets, shared by
 * tickTaskProgress's completion path (TaskProgress.ts) and cancelAction
 * (TaskCancellation.ts) — both need the task/skill bookkeeping reset once an
 * action stops occupying the employee, whether it finished normally or was
 * cancelled mid-flight.
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
  if (ghostIdx !== -1) {
    state.ghostPreviews.splice(ghostIdx, 1);
    state.ghostPreviewsRevision++;
  }

  return action ?? null;
}

/**
 * Complete `actionId` only if it still names a 'rest' PendingAction — a
 * no-op otherwise. Shared by RestCompletion.ts's tickGeneralRestCompletion
 * and ShiftCycle.ts's completeRestTick (#928): a vehicle-gated action's own
 * arrival-promotion loop (ArrivalGate.ts) can leave an employee's
 * activeActionId naming an unrelated, still-genuinely-in-progress action by
 * rest-completion time (ArrivalGate.ts's own stale-claim guard closes the
 * race going forward, but a rest completion still needs to check what
 * activeActionId names before deleting it, rather than assume it is always
 * this rest's own action). Both call sites looked up activeActionId,
 * checked completedAction?.type === 'rest', and only then called
 * completePendingAction — this centralizes that lookup + check + call.
 */
export function completeIfOwnedRestAction(
  state: GameState,
  actionId: number | null,
): PendingAction | null {
  if (actionId === null) return null;
  const action = state.pendingActions.find(a => a.id === actionId);
  if (action?.type !== 'rest') return null;
  return completePendingAction(state, actionId);
}
