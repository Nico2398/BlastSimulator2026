// BlastSimulator2026 — Task cancellation/interruption (skeleton, #767)
// Extracted from TaskDispatch.ts: player-initiated cancellation and
// needs-driven interruption of a PendingAction. Depends on
// TaskLifecycleCore.ts only — never on TaskDispatch.ts, to avoid a circular
// import.
//
// Skeleton phase only: signatures/types are final, bodies are stubs.
// Real logic moves here at implementation phase (#767).

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import { clearActiveTaskFields, completePendingAction } from './TaskLifecycleCore.js';

export interface CancelActionResult {
  success: boolean;
  /** 'not-found' — no action with that id. 'not-cancellable' — engine-owned rest action. */
  error?: 'not-found' | 'not-cancellable';
  /** The removed action, present on success. */
  action?: PendingAction;
  /** Amount refunded to state.cash, 0 when the action's type charges nothing at order time. */
  refunded?: number;
}

/**
 * Cancel a PendingAction by id, at any lifecycle stage (queued, assigned,
 * in_progress). Rejects 'rest' actions — engine-owned, never
 * player-cancellable (#548).
 */
export function cancelAction(state: GameState, actionId: number): CancelActionResult {
  void state;
  void actionId;
  void clearHolderWalkFields;
  void completePendingAction;
  void actionOrderCost;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/**
 * Release `employee`'s ONE active PendingAction (`actionId`) back to the
 * pool instead of removing it (#549) — see the real TaskDispatch.ts
 * docstring (pre-split) for the full lifecycle contract this preserves.
 */
export function interruptActiveAction(
  state: GameState,
  employee: Employee,
  actionId: number | null,
  options?: { keepVehicleDriver?: boolean },
): void {
  void state;
  void employee;
  void actionId;
  void options;
  void clearHolderWalkFields;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/**
 * Clears every walk/task-claim field an active or in-flight claim sets on
 * `employee`, on top of clearActiveTaskFields — shared by cancelAction and
 * interruptActiveAction. Internal to this file.
 */
function clearHolderWalkFields(emp: Employee): void {
  void emp;
  void clearActiveTaskFields;
  // TODO: implement (#767)
}

/**
 * Order-time cost already charged for an action's type — survey today, 0 for
 * everything else. Used by cancelAction to compute the refund. Internal to
 * this file.
 */
function actionOrderCost(action: PendingAction): number {
  void action;
  // TODO: implement (#767)
  return 0;
}
