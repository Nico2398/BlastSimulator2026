// BlastSimulator2026 — Proactive need-task insertion
//
// Inserts rest PendingActions for employees whose need gauges have fallen
// below their warning thresholds, for both idle and busy employees (unlike
// NeedRestoration.ts's tickNeedRestoration, which only handles idle ones and
// claims immediately — this leaves a busy employee's rest action queued,
// unclaimed, for dispatch to pick up later). Split out of GameLoop.ts as part
// of #759's file-size split; re-exported there so GameLoop.ts stays the
// single public surface for tick-orchestration callers.

import type { GameState } from '../state/GameState.js';
import type { NeedKey } from '../entities/Employee.js';
import type { FiredEvent } from '../events/EventSystem.js';
import type { EventEmitter } from '../state/EventEmitter.js';

export interface NeedInsertionResult {
  /** Employee/need pairs that had a rest PendingAction inserted. */
  inserted: Array<{ employeeId: number; needKey: NeedKey }>;
  /** Employee/need pairs that were skipped with a reason. */
  skipped: Array<{ employeeId: number; needKey: NeedKey; reason: string }>;
}

/**
 * Proactively inserts rest PendingActions for employees whose need gauges
 * have fallen below their warning thresholds (NEED_WARNING_THRESHOLDS).
 *
 * Unlike tickNeedRestoration() which handles only idle employees and
 * immediately assigns the action (sets activeActionId), this function handles
 * both idle and busy employees. For busy employees, the rest action is
 * inserted into the pending queue without claiming it.
 *
 * Dead, injured, and collapsing employees are skipped.
 * Employees that already have a rest PendingAction in the queue are skipped.
 */
export function autoInsertNeedTasks(
  state: GameState,
  _firedEvents?: FiredEvent[],
  _emitter?: EventEmitter,
  justCompletedRestEmployeeIds?: ReadonlySet<number>,
): NeedInsertionResult {
  void state; void _firedEvents; void _emitter; void justCompletedRestEmployeeIds;
  // TODO: implement
  throw new Error('not implemented');
}
