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
import { clearResolvedEvacuationHolds, isMidEvacuation } from './Evacuation.js';
import { isLicensedForRole, hasBlockedQueuedActionForVehicleRole } from './VehicleReservation.js';
import { isMidCollapseOrForcedRest } from './RestActionHelpers.js';
import { isMounted, mountedVehicleId } from '../entities/EmployeeLocomotion.js';
import { alightIfMounted } from './Mount.js';
import { getVehicleReservation } from '../entities/Vehicle.js';

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
  // Same pass also stamps action.blockedReason (#1061) — a live diagnostic
  // NotificationCenter.ts surfaces as a non-blocking player warning, entirely
  // separate from the unqualifiedIds/result.unqualified heavy-modal channel
  // above: a vehicle-gated action is NEVER added to unqualifiedIds/
  // result.unqualified (see the doc comment above), but it still gets a
  // blockedReason when nobody can currently work it (no vehicle of that role
  // in the fleet, nobody licensed to drive one, or — matching the real claim
  // requirement in findVehicleForClaim/claimOnePoolCandidate,
  // EmployeeDispatchSteps.ts — nobody who is BOTH licensed for the role AND
  // holds action.requiredSkill, e.g. drill_hole needs driving.drill_rig AND
  // blasting on the same employee).
  const unqualifiedIds = new Set<number>();
  for (const action of state.pendingActions) {
    if (action.status !== 'queued') continue;
    // Shared shape between the vehicle-gated and plain branches below: an
    // action with no requiredSkill just needs a warm body from `emps`;
    // otherwise at least one of `emps` must hold the skill.
    const holdsRequiredSkill = (emps: Employee[]): boolean => action.requiredSkill === null
      ? emps.length > 0
      : emps.some(emp => emp.qualifications.some(q => q.category === action.requiredSkill));
    if (action.requiredVehicleRole !== null) {
      const role = action.requiredVehicleRole;
      const hasVehicle = state.vehicles.vehicles.some(v => v.type === role);
      const licensed = eligible.filter(emp => isLicensedForRole(emp, role));
      const hasQualifiedLicensed = holdsRequiredSkill(licensed);
      action.blockedReason = !hasVehicle
        ? 'no_vehicle_in_fleet'
        : licensed.length === 0 ? 'no_licensed_driver'
        : !hasQualifiedLicensed ? 'no_qualified_employee'
        : null;
      continue;
    }
    const hasQualified = holdsRequiredSkill(eligible);
    if (!hasQualified) {
      unqualifiedIds.add(action.id);
      result.unqualified.push(action.id);
    }
    action.blockedReason = hasQualified ? null : 'no_qualified_employee';
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
    // #1089 regression fix: an employee mid-itinerary with NO PendingAction
    // behind it — a bare `moveTo` the console's `vehicle move`/`assign
    // task:moving` commands install directly on an already-mounted driver
    // (MoveTo.ts, vehicle.ts) — reads exactly like an idle employee here
    // (activeActionId stays null the whole drive; that itinerary is not a
    // claim), so without this guard fillIdleEmployeeFromQueueOrPool claims
    // them a fresh action (setting activeActionId/destinationX/Z for a
    // legacy foot task, say) while their itinerary is still mid-drive.
    // Locomotion.ts always advances `itinerary` before falling back to
    // destinationX/Z (#1089), so that itinerary — once genuinely stuck (an
    // unreachable target a path resolves toward but never arrives at, e.g.
    // an off-navmesh `to:` coordinate) — silently pins the employee driving
    // forever, and the freshly claimed action never gets a single tick of
    // real progress (confirmed live: level1-playthrough-win.json's own
    // corridor-clearing `vehicle move 3 to:10,-2` — the same off-map
    // fallback landing tile a real click resolves to, per that step's own
    // finding — leaves employee #4 driving nowhere from tick ~16 onward;
    // tickEmployees then claims them for a `place_building` order at tick
    // 104 anyway, which then never lands because their real position never
    // moves again). An employee already holding a real claim (activeActionId
    // set) is untouched by this guard — mid-drive-for-a-claimed-action is the
    // normal, expected busy state `reserveOnePoolActionAhead` below already
    // handles.
    if (employee.activeActionId === null && employee.itinerary !== null) continue;
    // Mid-walk to a safe cell (evacuateZone) — like the boarding case just
    // above, walking outside the claim system entirely. Without this guard,
    // claimActionsTargetedAtEmployee would happily promote a pre-existing
    // targeted action (most often a proactive rest whose target is wherever
    // the employee was already standing — NeedTaskInsertion.ts) straight to
    // active, overwriting the evacuation destination with the employee's OWN
    // current position — inside the danger zone they were just ordered out
    // of — before they ever take a step, whether on foot or driving a
    // vehicle clear (isMidEvacuation, #1042). See isMidEvacuationWalk's own
    // doc comment (Evacuation.ts) for the shared reasoning across all four
    // call sites (#557).
    if (isMidEvacuation(employee)) continue;
    // Mid-collapse or mid-forced-rest (walking to rest, or already resting) —
    // like the guard above, outside the claim system entirely. Without this,
    // claimActionsTargetedAtEmployee reclaims a still-'queued',
    // walkOnlyPinnedBy-pinned action targeted at this exact employee
    // (TaskCancellation.ts) every single tick regardless of activeActionId,
    // undoing the rest path's own one-time
    // releaseUnboardedTaskQueueVehicleReservations call earlier in the
    // pipeline — net effect, a real vehicle stays reserved (pushed onto
    // taskQueue, never boarded) for the employee's entire rest, tripping
    // I5_reservation_without_valid_holder (#1096 for the collapse trigger,
    // #1110 for the shift-rest trigger). See isMidCollapseOrForcedRest's own
    // doc comment (RestActionHelpers.ts) for why the two triggers are one
    // predicate. Dispatch resumes for this employee the tick their rest
    // completes (RestActionHelpers.ts's completeRestForEmployee).
    if (isMidCollapseOrForcedRest(employee)) continue;
    claimActionsTargetedAtEmployee(state, employee, result);
    if (employee.activeActionId === null) {
      fillIdleEmployeeFromQueueOrPool(state, employee, result);
      // #1090 follow-up: still idle after this tick's own dispatch attempt
      // found nothing for them, but mounted — with no dismount-on-completion
      // any more, a driver whose own work ran out (no same-role follow-up
      // queued anywhere) would otherwise sit mounted forever, permanently
      // hostage to nobody, while a DIFFERENT employee's own separately
      // targeted action for that exact role can never claim the vehicle
      // (findFreeVehicleForRole only ever considers driverId === null, or
      // the requesting employee's own current vehicle). Alighting here —
      // only once this tick's own claim attempt has already had first
      // refusal, and only when hasBlockedQueuedActionForVehicleRole confirms
      // some OTHER employee's queued (or untargeted) action for this exact
      // role is genuinely starved — frees the vehicle for that other
      // employee's own claim, the very next tick, without reintroducing a
      // same-role continuity special case for the common case where a
      // follow-up this same employee could claim exists instead (they would
      // already hold it, via fillIdleEmployeeFromQueueOrPool just above).
      // `hasQueuedActionForVehicleRole` (the employeeId-scoped sibling
      // predicate) cannot stand in here: it reads identically false for the
      // real hostage bug this exists to fix AND for a vehicle boarded by a
      // bare `vehicle driver`/`vehicle move` console command with no
      // PendingAction behind it at all — evicting the latter's driver within
      // one dispatch tick of boarding (confirmed live: nav-move-costs-visual,
      // vehicle-traffic, vehicle-task-states-visual and every other scenario
      // driving a vehicle by hand).
      if (employee.activeActionId === null && isMounted(employee.locomotion)) {
        const vehicle = state.vehicles.vehicles.find(v => v.id === mountedVehicleId(employee.locomotion));
        // reservedForActionId !== null already means this exact vehicle is
        // spoken for — either this same employee's own reserved-ahead
        // taskQueue entry (reserveOnePoolActionAhead, #611 — 'assigned', not
        // 'queued', so hasBlockedQueuedActionForVehicleRole's own query would
        // miss it and wrongly alight the one employee still holding it) or
        // another employee's; either way, alighting here would desync the
        // reservation from a driver assertWorldInvariants' I5 check expects
        // to still resolve.
        if (vehicle && getVehicleReservation(state.vehicles, vehicle.id) === null && hasBlockedQueuedActionForVehicleRole(state, vehicle.type, employee.id)) {
          alightIfMounted(state, employee);
        }
      }
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
 * Work-state classification for NEED_DRAIN_RATES purposes (#680, extended to
 * 'traveling' by #928, and again for a vehicle-gated mid-drive by #1090's own
 * livelock follow-up). See EmployeeWorkState for the four states.
 *
 * pendingTaskDuration/pendingRestDuration cover the on-foot outbound-walk and
 * return-to-rest cases (#928) — but a vehicle-gated action's own duration is
 * deliberately never staged into pendingTaskDuration until the vehicle
 * physically arrives (ArrivalGate.ts's own doc comment, #1089), so those two
 * fields alone stay null for the whole approach drive to a claimed
 * dig_ramp_segment/drill_hole/etc, and the old fallback below read that
 * (activeActionId already set, nothing else claimed yet) as 'working' — full
 * fatigue drain for a leg where no work is actually happening yet, exactly
 * the bug #928 fixed for the on-foot case. `itinerary` (or, for the rare
 * fallback to a direct-write walk, destinationX/Z — see beginRestTravel's own
 * doc comment, RestActionHelpers.ts) is non-null for exactly this same "still
 * travelling, not yet arrived" window regardless of mover
 * (ArrivalGate.tickArrivalGate's own `arrived` check reads the identical
 * three fields), so it closes the gap the same way pendingTaskDuration does
 * for the on-foot case. Confirmed live via needs.integration.test.ts's #945
 * box-cut suite and the tutorial-boxcut-full scenario: a mounted forced-rest
 * round trip billed its drive at the 'working' rate (2/tick, further
 * multiplied by low morale) instead of 'traveling' (1/tick), so a round trip
 * that fit the fatigue budget at the correct rate blew straight through it —
 * a permanent livelock, not a distance problem needing a cap.
 */
export function employeeWorkState(emp: Employee): EmployeeWorkState {
  if (emp.restTicksRemaining !== null) return 'resting';
  if (
    emp.pendingTaskDuration !== null || emp.pendingRestDuration !== null
    || emp.itinerary !== null || emp.destinationX !== null || emp.destinationZ !== null
  ) return 'traveling';
  if (emp.activeActionId !== null) return 'working';
  return 'idle';
}
