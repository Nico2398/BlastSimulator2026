// BlastSimulator2026 — General rest completion (hunger / breakNeed / Tier-1
// fatigue)
//
// Completion path for 'rest' PendingActions created by NeedRestoration.ts's
// tickCollapse/tickNeedRestoration, NeedTaskInsertion.ts's autoInsertNeedTasks,
// and (once a site policy is applied) ForceShiftRest.ts's
// forceShiftRestIfNeededByPolicy. Split out of GameLoop.ts as part of #759's
// file-size split; re-exported there so GameLoop.ts stays the single public
// surface for tick-orchestration callers.

import type { GameState } from '../state/GameState.js';
import type { NeedKey } from '../entities/Employee.js';

export interface GeneralRestCompletionResult {
  /** Employee/need pairs whose rest completed this tick. */
  completed: Array<{ employeeId: number; needKey: NeedKey }>;
}

/**
 * Completion path for 'rest' PendingActions created by tickCollapse,
 * tickNeedRestoration, and autoInsertNeedTasks — every hunger and breakNeed
 * rest, plus fatigue rest when no Bunkhouse Tier 2+ living_quarters exists to
 * service it via ShiftCycle.ts's processShiftCycle. Decrements
 * restTicksRemaining, and on completion replenishes the resting need gauge
 * (RestActionHelpers.completeRestForEmployee), deducts its NEED_REST_COSTS
 * entry, then clears activeActionId/restTicksRemaining so the employee
 * returns to normal task dispatch.
 */
export function tickGeneralRestCompletion(state: GameState): GeneralRestCompletionResult {
  void state;
  // TODO: implement
  throw new Error('not implemented');
}
