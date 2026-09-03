// BlastSimulator2026 — General rest completion (fatigue)
//
// Completion path for 'rest' PendingActions created by NeedRestoration.ts's
// tickCollapse/tickNeedRestoration, NeedTaskInsertion.ts's autoInsertNeedTasks,
// and (once a site policy is applied) ForceShiftRest.ts's
// forceShiftRestIfNeededByPolicy. Split out of GameLoop.ts as part of #759's
// file-size split; re-exported there so GameLoop.ts stays the single public
// surface for tick-orchestration callers.

import type { GameState } from '../state/GameState.js';
import type { NeedKey } from '../entities/Employee.js';
import { completePendingAction } from './TaskDispatch.js';
import { completeRestForEmployee } from './RestActionHelpers.js';

export interface GeneralRestCompletionResult {
  /** Employee/need pairs whose rest completed this tick. */
  completed: Array<{ employeeId: number; needKey: NeedKey }>;
}

/**
 * Completion path for 'rest' PendingActions created by tickCollapse,
 * tickNeedRestoration, and autoInsertNeedTasks — every fatigue rest, when no
 * Bunkhouse Tier 2+ living_quarters exists to
 * service it via processShiftCycle. Mirrors completeRestTick's structure:
 * decrement restTicksRemaining, and on completion replenish the resting need
 * gauge, deduct its NEED_REST_COSTS entry, then clear activeActionId/
 * restTicksRemaining so the employee returns to normal task dispatch.
 *
 * Only owns employees whose restNeedKey identifies a resting need (set at
 * rest-start by the three creators above, or by tickEmployees when it claims
 * a queued autoInsertNeedTasks action). Bunkhouse Tier 2+ shift-cycle rest
 * under the legacy no-policy path leaves restNeedKey null and remains owned
 * by processShiftCycle/completeRestTick — but once a site policy has been
 * applied, forceShiftRestIfNeededByPolicy (#678) sets pendingRestNeedKey/
 * restNeedKey for its own shift-forced rests too, so those ARE owned here,
 * not by completeRestTick. This function also resets ticksWorked on
 * completion, but only for rests it can identify as policy-forced (payload's
 * triggeredBy === 'shift_cycle_policy') — see the check inline below.
 *
 * Injury does not block completion — an employee who becomes injured mid-rest
 * must still have their rest action finished and cleaned up, or activeActionId
 * would stay set forever.
 */
export function tickGeneralRestCompletion(state: GameState): GeneralRestCompletionResult {
  const completed: Array<{ employeeId: number; needKey: NeedKey }> = [];

  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    if (emp.restTicksRemaining === null) continue;

    const needKey = emp.restNeedKey;
    if (needKey === null) continue; // owned by processShiftCycle instead

    emp.restTicksRemaining -= 1;
    if (emp.restTicksRemaining > 0) continue;

    const completedActionId = emp.activeActionId;
    // forceShiftRestIfNeededByPolicy marks its own rest action's payload with
    // triggeredBy: 'shift_cycle_policy' (checked before completeRestForEmployee
    // clears activeActionId) — that marker is what distinguishes it here from
    // the other three rest creators (tickCollapse/tickNeedRestoration/
    // autoInsertNeedTasks), whose payloads never use that value. Only a
    // policy-forced shift rest restarts the continuous-work clock; see
    // forceShiftRestIfNeededByPolicy's doc comment (#678).
    const completedAction = completedActionId !== null
      ? state.pendingActions.find(a => a.id === completedActionId)
      : undefined;
    const isPolicyShiftRest = completedAction?.payload.triggeredBy === 'shift_cycle_policy';

    completeRestForEmployee(state, emp, needKey);
    // tickCollapse/tickNeedRestoration/autoInsertNeedTasks leave the rest
    // action in pendingActions at creation (self-claimed or claimed later via
    // tickEmployees), so nothing else removes it once the rest completes.
    //
    // #928: gated on completedAction?.type === 'rest', not just
    // completedActionId !== null. emp.activeActionId is meant to still name
    // this employee's own rest action at completion time, but a vehicle-gated
    // action's own arrival-promotion loop (ArrivalGate.ts) re-seeds
    // taskTicksRemaining for a claimed action's holder keyed only on
    // taskTicksRemaining === null, with no check that the holder is still
    // the one actively working it (nor that they aren't ALSO mid-rest) — a
    // still-driving, still-reserved vehicle can resurrect a stale claim on an
    // employee who has since been sent to rest, and that phantom task's own
    // NORMAL completion (tickTaskProgress) then overwrites activeActionId out
    // from under this employee's own, still-in-progress rest. Direct-traced
    // (command mode, blast-execution-visual.json): under this file's own
    // set_policy mode:shift_8h with no living_quarters anywhere (every rest
    // is in-place, NEED_REST_NO_BUILDING_DURATION_MULTIPLIER-doubled), an
    // employee this happens to hits this exact race far more often than
    // pre-#928's three-gauge model ever did — activeActionId ends up naming
    // an unrelated, still-genuinely-in-progress charge_hole action, and this
    // line's own unconditional completePendingAction call was deleting that
    // action's record outright without ever landing its charge, permanently
    // stalling orderedChargeCount for the holes it touched. The vehicle-gated
    // arrival-promotion race itself is a separate, general engine gap
    // (ArrivalGate.ts) reasonably out of this fix's own scope; this guard
    // only stops rest completion from deleting whatever activeActionId
    // happens to name when it isn't this rest's own action.
    if (completedActionId !== null && completedAction?.type === 'rest') {
      completePendingAction(state, completedActionId);
    }

    // Mirrors completeRestTick's unconditional ticksWorked = 0 on completion —
    // without this, a policy-forced rest never resets the continuous-work
    // clock (nothing else does), so the very next tick immediately re-trips
    // shouldForceRest and yanks the employee back into rest (#678).
    if (isPolicyShiftRest) emp.ticksWorked = 0;

    completed.push({ employeeId: emp.id, needKey });
  }

  return { completed };
}
