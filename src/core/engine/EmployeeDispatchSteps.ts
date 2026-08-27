// BlastSimulator2026 — Per-employee dispatch claim/promote steps (#549)
//
// The three-step-per-employee claim sequence EmployeeDispatch.ts's
// tickEmployees runs for each employee every tick: claim actions targeted at
// them, fill from their own queue or the open pool, or reserve one pool
// action ahead while busy — plus the shared promoteActionToActive that both
// this module and VehicleContinuity.ts use to hand a claimed action to an
// employee. Split out of GameLoop.ts as part of #759's file-size split;
// re-exported there so GameLoop.ts stays the single public surface for
// tick-orchestration callers.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { SelectedAction } from './ActionSelection.js';

export interface TickEmployeesResult {
  claimed: number[];     // IDs of PendingActions that were newly claimed (queued -> assigned) this tick
  unqualified: number[]; // IDs of PendingActions no roster employee can ever do
  waiting: number[];     // IDs of PendingActions still queued after this tick (busy/unreachable/no budget left)
}

/**
 * Step 1 of tickEmployees: claim every still-queued action targeted
 * specifically at `employee`, up to MAX_EMPLOYEE_TASK_QUEUE_DEPTH total
 * (active + taskQueue). See GameLoop.ts's pre-#759 doc comment for the full
 * algorithm this was extracted from.
 */
export function claimActionsTargetedAtEmployee(state: GameState, employee: Employee, result: TickEmployeesResult): void {
  void state; void employee; void result;
  // TODO: implement
}

/**
 * Step 2 of tickEmployees: called only when `employee` is still idle after
 * step 1. Recomputes the cheapest entry from the employee's own taskQueue, or
 * — when taskQueue is empty — claims exactly one candidate from the open
 * pool (targetEmployeeId === null). Never both in the same tick.
 */
export function fillIdleEmployeeFromQueueOrPool(state: GameState, employee: Employee, result: TickEmployeesResult): void {
  void state; void employee; void result;
  // TODO: implement
}

/**
 * Filter the open pool (targetEmployeeId === null, still 'queued') down to
 * candidates `employee` qualifies for, pick the cheapest reachable one, and
 * claim it. Used by both fillIdleEmployeeFromQueueOrPool and
 * reserveOnePoolActionAhead below.
 */
export function claimOnePoolCandidate(state: GameState, employee: Employee): SelectedAction | null {
  void state; void employee;
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Step 3 of tickEmployees: called only when `employee` is still busy after
 * steps 1-2 (activeActionId !== null). Reserves exactly one more open-pool
 * candidate ahead into taskQueue, when there is room under
 * MAX_EMPLOYEE_TASK_QUEUE_DEPTH.
 */
export function reserveOnePoolActionAhead(state: GameState, employee: Employee, result: TickEmployeesResult): void {
  void state; void employee; void result;
  // TODO: implement
}

/**
 * Promote a claimed action to active on `employee`: sets activeActionId,
 * sends them walking toward the target, and seeds either
 * pendingRestDuration/pendingRestNeedKey (rest) or pendingTaskDuration/
 * activeTaskSkill/pendingActionType/pendingActionPayload (everything else).
 * Also used by VehicleContinuity.ts's tryContinueVehicleGatedAction.
 */
export function promoteActionToActive(state: GameState, employee: Employee, action: PendingAction): void {
  void state; void employee; void action;
  // TODO: implement
}
