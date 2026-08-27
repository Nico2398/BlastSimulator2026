// BlastSimulator2026 — Vehicle-continuity inline promotion (#550)
//
// Called by events.ts's completion pass the instant a vehicle-gated action
// finishes: keeps the driver mounted onto a same-role follow-up action
// instead of dismounting and re-walking, or releases the vehicle/completes
// the PendingAction when there is no follow-up (#552). Split out of
// GameLoop.ts as part of #759's file-size split; re-exported there so
// GameLoop.ts stays the single public surface for tick-orchestration callers.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';

/**
 * Vehicle-continuity inline promotion (#550). Looks for a same-
 * `requiredVehicleRole` follow-up already available to `employee` — first
 * their own `taskQueue`, then the still-`queued` pool — and, if one exists,
 * transfers the just-finished action's vehicle reservation straight to it
 * and promotes it to active immediately.
 */
export function tryContinueVehicleGatedAction(
  state: GameState,
  employee: Employee,
  completedAction: PendingAction,
): boolean {
  void state; void employee; void completedAction;
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Shared completion path for any vehicle-gated action (#552): continuity-
 * promote a same-role follow-up action if one exists (via
 * tryContinueVehicleGatedAction), else release the vehicle/dismount the
 * employee, then remove the PendingAction record and its ghost preview.
 */
export function completeVehicleGatedActionIfApplicable(state: GameState, emp: Employee, actionId: number): void {
  void state; void emp; void actionId;
  // TODO: implement
}
