// BlastSimulator2026 — Task lifecycle core (skeleton, #767)
// Leaf module extracted from TaskDispatch.ts: clears the active-task
// bookkeeping fields an employee's claim sets, and removes a completed
// PendingAction (plus its ghost preview) from state. No dependency on
// TaskCancellation.ts — that file depends on this one, never the reverse,
// so the split introduces no circular import.
//
// Skeleton phase only: signatures/types are final, bodies are stubs.
// Real logic moves here at implementation phase (#767).

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';

/**
 * Clears the fields an employee's active-task claim sets, shared by
 * tickTaskProgress's completion path (GameLoop.ts) and cancelAction
 * (TaskCancellation.ts) — both need the task/skill bookkeeping reset once an
 * action stops occupying the employee, whether it finished normally or was
 * cancelled mid-flight.
 */
export function clearActiveTaskFields(emp: Employee): void {
  void emp;
  // TODO: implement (#767)
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
  void state;
  void actionId;
  // TODO: implement (#767)
  return null;
}
