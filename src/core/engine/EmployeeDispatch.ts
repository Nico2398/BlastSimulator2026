// BlastSimulator2026 — Employee dispatch (#549 cost-based)
//
// Matches queued PendingActions to idle employees, ranked by
// estimateActionCost/selectBestActionForEmployee (ActionSelection.ts) instead
// of first-come-first-served. The per-employee claim/promote steps this
// function calls live in EmployeeDispatchSteps.ts. Split out of GameLoop.ts
// as part of #759's file-size split; re-exported there so GameLoop.ts stays
// the single public surface for tick-orchestration callers.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { EmployeeWorkState } from '../entities/EmployeeNeeds.js';
import {
  claimActionsTargetedAtEmployee, fillIdleEmployeeFromQueueOrPool, reserveOnePoolActionAhead,
  type TickEmployeesResult,
} from './EmployeeDispatchSteps.js';
import { clearResolvedEvacuationHolds, isMidEvacuationWalk } from './Evacuation.js';

/**
 * Match pending actions to idle qualified employees, ranked by cost
 * (estimateActionCost/selectBestActionForEmployee — travel time + work
 * duration, ActionSelection.ts) instead of first-come-first-served (#549).
 *
 * Processes employees in ascending id order for determinism. For each:
 *   1. Claim actions already targeted at this employee (targetEmployeeId ===
 *      employee.id, still 'queued') — never contested by anyone else, so
 *      claimed eagerly up to MAX_EMPLOYEE_TASK_QUEUE_DEPTH (active + queued).
 *      The first one claimed while the employee is idle is promoted straight
 *      to active; the rest are pushed onto taskQueue.
 *   2. If still idle: recompute the cheapest entry from taskQueue (if
 *      non-empty) from the employee's actual current position, or otherwise
 *      claim exactly one candidate from the open pool (targetEmployeeId ===
 *      null) — never both in the same tick.
 *   3. If still busy afterward with a genuine, non-'rest' active task (not a
 *      resting employee, and not one whose activeActionId doesn't correspond
 *      to a real record) and taskQueue has room under
 *      MAX_EMPLOYEE_TASK_QUEUE_DEPTH: reserve exactly one more candidate from
 *      the open pool ahead into taskQueue — this is what lets a single busy
 *      employee build up a multi-action personal queue from open-pool work
 *      (not just targeted actions) across several ticks, one reservation per
 *      tick, same fairness rule as step 2's single pool claim.
 *
 * Mutates state: transitions claimed actions' status/holderId in place (and
 * marks their ghost `claimed`) instead of removing them — the record and its
 * ghost persist until completePendingAction runs at completion (#547). An
 * action selectBestActionForEmployee reports unreachable (null) leaves the
 * employee idle this tick to retry next tick — never marked stuck, taskQueue
 * left untouched. Actions already 'assigned' or 'in_progress' are skipped
 * entirely — not re-evaluated as claimable, not counted as still-waiting.
 */
export function tickEmployees(state: GameState): TickEmployeesResult {
  // One-shot cleanup: strip EVACUATION_HOLD_KEY from any action whose zone
  // has genuinely cleared, before this tick's claim filters (below, via
  // EmployeeDispatchSteps.ts's isEvacuationHoldActive) run — see
  // clearResolvedEvacuationHolds' own doc comment (Evacuation.ts) for why
  // this is a separate, explicitly-called step rather than a side effect of
  // the filter check itself (#557 review).
  clearResolvedEvacuationHolds(state);

  const result: TickEmployeesResult = { claimed: [], unqualified: [], waiting: [] };

  // Base eligibility: alive, not injured, not in training.
  const eligible = state.employees.employees.filter(
    emp => emp.alive && !emp.injured && emp.trainingState === null,
  );

  // Actions no eligible employee could ever perform, computed once up front —
  // qualification doesn't change during this tick's dispatch pass. A
  // vehicle-gated action (requiredVehicleRole !== null, e.g. HaulDispatch's
  // haul_debris/fragment_debris, #552) is never flagged here regardless of
  // roster headcount — its real gate is vehicle/driver availability at claim
  // time (findVehicleForClaim, VehicleReservation.ts), not this employee-skill
  // check. Treating "zero employees on the whole roster" as "unqualified" for
  // these would auto-pause a fresh, unstaffed site with an unresolvable
  // unqualified_task_error every single tick forever (no option on that event
  // actually removes the action) the instant a blast leaves debris on the
  // ground — HaulDispatch.ts's own doc comment already promises these sit
  // queued silently until a hauler/driver exists; requiredSkill===null alone
  // doesn't deliver that promise when the roster is completely empty.
  const unqualifiedIds = new Set<number>();
  for (const action of state.pendingActions) {
    if (action.status !== 'queued') continue;
    if (action.requiredVehicleRole !== null) continue;
    const hasQualified = action.requiredSkill === null
      ? eligible.length > 0
      : eligible.some(emp => emp.qualifications.some(q => q.category === action.requiredSkill));
    if (!hasQualified) {
      unqualifiedIds.add(action.id);
      result.unqualified.push(action.id);
    }
  }

  const orderedEmployees = [...eligible].sort((a, b) => a.id - b.id);
  for (const employee of orderedEmployees) {
    // An employee mid-walk to board a vehicle from a manual `vehicle driver`
    // command (pendingDriverVehicleId set, VehicleBoarding.ts) has not yet
    // gone through claim/promotion at all — activeActionId is still null, so
    // without this guard they read as idle and fillIdleEmployeeFromQueueOrPool
    // would happily claim them a pool haul_debris/fragment_debris action on
    // the very same vehicle they are about to board. resolveBoarding
    // (ArrivalGate.ts) then reserves the vehicle for that new action and, if
    // the workflow can't start yet (no depot, fragment moved on), calls
    // interruptActiveAction -> releaseVehicleReservation, which unassigns
    // the driver it had just seated moments earlier in that same tick — the
    // manual command silently loses its boarding underneath the player.
    // Skipping the whole claim sequence while a boarding walk is in flight
    // leaves it to resolve on its own first; dispatch resumes for this
    // employee the very next tick either way (#552).
    if (employee.pendingDriverVehicleId !== null) continue;
    // Mid-walk to a safe cell (evacuateZone) — like the boarding case just
    // above, walking outside the claim system entirely. Without this guard,
    // claimActionsTargetedAtEmployee would happily promote a pre-existing
    // targeted action (most often a proactive rest whose target is wherever
    // the employee was already standing — NeedTaskInsertion.ts) straight to
    // active, overwriting the evacuation destination with the employee's OWN
    // current position — inside the danger zone they were just ordered out
    // of — before they ever take a step. See isMidEvacuationWalk's own doc
    // comment (Evacuation.ts) for the shared reasoning across all four call
    // sites (#557).
    if (isMidEvacuationWalk(employee)) continue;
    claimActionsTargetedAtEmployee(state, employee, result);
    if (employee.activeActionId === null) {
      fillIdleEmployeeFromQueueOrPool(state, employee, result);
    } else {
      reserveOnePoolActionAhead(state, employee, result);
    }
  }

  for (const action of state.pendingActions) {
    if (action.status === 'queued' && !unqualifiedIds.has(action.id)) {
      result.waiting.push(action.id);
    }
  }

  return result;
}

/**
 * Work-state classification for NEED_DRAIN_RATES purposes (#680).
 * See EmployeeWorkState for the three states.
 */
export function employeeWorkState(emp: Employee): EmployeeWorkState {
  if (emp.restTicksRemaining !== null) return 'resting';
  if (emp.activeActionId !== null && emp.pendingRestDuration === null) return 'working';
  return 'idle';
}
