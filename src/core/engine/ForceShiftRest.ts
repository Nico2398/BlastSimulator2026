// BlastSimulator2026 — Forced shift rest (legacy and site-policy-aware)
//
// forceShiftRestIfNeeded is the legacy fatigue-only, fixed-duration path used
// while no site policy has been applied; forceShiftRestIfNeededByPolicy
// (#678) is the policy-aware variant that consults SitePolicy.shouldForceRest
// once one has. Both are called from ShiftCycle.ts's processShiftCycle. Split
// out of GameLoop.ts as part of #759's file-size split; re-exported there so
// GameLoop.ts stays the single public surface for tick-orchestration callers.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee, NeedKey } from '../entities/Employee.js';
import type { FiredEvent } from '../events/EventSystem.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { interruptActiveAction } from './TaskDispatch.js';
import { createRestPendingAction, findNearestLivingQuarters, resolveBuildingApproach } from './RestActionHelpers.js';
import { isMidVehicleGatedWork } from './VehicleReservation.js';
import { isMidEvacuationWalk } from './Evacuation.js';
import { shouldForceRest } from '../entities/SitePolicy.js';
import { WORK_DURATION_TICKS, SHIFT_SLEEP_DURATION_TICKS, NEED_REST_DURATIONS } from '../config/balance.js';

/**
 * Shared tail of forceShiftRestIfNeeded and forceShiftRestIfNeededByPolicy:
 * queues restAction, updates emp's activeActionId/destination, records the
 * shift-change bookkeeping (shiftRested/firedEvents/emitter).
 */
function finishForceRest(
  state: GameState,
  emp: Employee,
  restAction: PendingAction,
  firedEvents: FiredEvent[],
  shiftRested: number[],
  _emitter?: EventEmitter,
): void {
  state.pendingActions.push(restAction);
  emp.activeActionId = restAction.id;
  emp.destinationX = restAction.targetX;
  emp.destinationZ = restAction.targetZ;
  shiftRested.push(emp.id);
  firedEvents.push({ eventId: 'employee_shift_change', firedAtTick: state.tickCount });
  _emitter?.emit('employee:shift_change', { employeeId: emp.id });
}

/**
 * If an active employee has worked enough ticks, force a shift rest:
 * find the nearest living_quarters, create a rest PendingAction, and set restTicksRemaining.
 */
export function forceShiftRestIfNeeded(
  state: GameState,
  emp: Employee,
  firedEvents: FiredEvent[],
  shiftRested: number[],
  _emitter?: EventEmitter,
): void {
  if (emp.restTicksRemaining !== null) return;
  // Already walking to a shift rest queued on a prior tick — without this,
  // ticksWorked stays >= WORK_DURATION_TICKS for the whole walk (it's only
  // reset on rest completion) and this would requeue a duplicate rest action
  // every tick until arrival (#437).
  if (emp.pendingRestDuration !== null) return;
  // Already walking to a claimed task, not yet arrived — mirrors the
  // pendingRestDuration guard above for the task-travel case (#928). Exempts
  // a genuinely stuck walk (isMoveStuck — EntityMovementTick.ts) rather than
  // blocking unconditionally: an employee whose claimed destination has
  // become unreachable (e.g. boxed in by a building placed after the walk
  // was claimed) would otherwise never again be eligible for this function's
  // own rescue-to-living-quarters path, left defenseless (no proactive rest,
  // no evacuation reroute) against a danger zone it happens to be standing
  // in — confirmed live via vibration-budget.json's own grid-2 safety
  // dispatch, whose target tile was later claimed by a living_quarters
  // build order.
  if (emp.pendingTaskDuration !== null && !emp.isMoveStuck) return;
  // Already arrived and mid-execution of a claimed task (e.g. dig_ramp_segment)
  // — mirrors the pendingTaskDuration guard above for the already-arrived
  // case (#945): interrupting a task the employee is actively ticking through
  // forces a walk-back-and-redo once the rest ends, instead of letting the
  // in-progress task finish first.
  if (emp.taskTicksRemaining !== null) return;
  if (emp.activeActionId === null) return;
  if (emp.ticksWorked < WORK_DURATION_TICKS) return;

  // Release the action this employee was actively working back to the pool
  // before handing activeActionId to the rest action below — mirrors
  // tickCollapse's and forceShiftRestIfNeededByPolicy's own interruptActiveAction
  // call for the identical reason (#684): without this, overwriting
  // activeActionId directly orphans the interrupted action permanently.
  const priorActionId = emp.activeActionId;
  interruptActiveAction(state, emp, priorActionId);

  // Find nearest living_quarters for target coordinates
  const building = findNearestLivingQuarters(state, emp.x, emp.z);
  let targetX = emp.x;
  let targetZ = emp.z;
  let buildingId: number | undefined;

  if (building) {
    const approach = resolveBuildingApproach(state, building, emp.x, emp.z);
    targetX = approach.x;
    targetZ = approach.z;
    buildingId = building.id;
  }

  // The rest timer itself does not start until ArrivalGate.tickArrivalGate
  // confirms the employee has walked to the bunkhouse (#437).
  emp.pendingRestDuration = SHIFT_SLEEP_DURATION_TICKS;

  // Immediately claimed — status/holderId reflect that from creation (#547).
  const restAction = createRestPendingAction(state, {
    targetX,
    targetZ,
    targetEmployeeId: emp.id,
    payload: { needType: 'fatigue', triggeredBy: 'shift_cycle', buildingId },
  }, emp.id);

  finishForceRest(state, emp, restAction, firedEvents, shiftRested, _emitter);
}

/**
 * Site-policy-aware variant of forceShiftRestIfNeeded (#678) — consults
 * SitePolicy.shouldForceRest so an applied policy (state.sitePolicy.revision
 * > 0) forces rest for real, using any living_quarters tier (tier 1
 * included) or resting in place if none exists.
 *
 * Guards: skip an employee already resting (restTicksRemaining !== null),
 * already walking to a queued rest (pendingRestDuration !== null), already
 * arrived and mid-execution of a boarded vehicle-gated action
 * (taskTicksRemaining !== null && isMidVehicleGatedWork — #945, waits for
 * the driver to naturally dismount, e.g. on segment/task completion with no
 * same-vehicle follow-up, rather than forcing a dismount-and-reboard
 * mid-task; deliberately does NOT also cover the mid-drive-to-target phase
 * or an on-foot task — see the guard's own inline comment for why), or
 * mid-walk to board a vehicle from a manual `vehicle driver` command
 * (pendingDriverVehicleId !== null — mirrors tickEmployees' own guard on the
 * same field, EmployeeDispatch.ts's #552 comment) — overwriting activeActionId/
 * destinationX/Z on that employee here would silently cancel the boarding
 * walk underneath the player. Otherwise runs for an idle employee
 * (activeActionId === null) exactly like a working one (#707 fix): earlier
 * this function returned early on idle, on the reasoning that "an idle
 * employee has nothing to interrupt and is handled by the other
 * need-restoration paths instead" — but those other paths
 * (autoInsertNeedTasks) fire at the much lower reactive
 * NEED_WARNING_THRESHOLDS.fatigue (25), not this policy's own configured (and
 * player-chosen, typically higher) fatigueRestThreshold. An idle employee — one
 * with no active task to interrupt because none exists yet, not one who
 * chose to slack off — drained on the low reactive threshold instead of the
 * policy's proactive one, so a long enough idle stretch (no work queued for
 * them) crashed morale well before any work-driven trigger ever got a
 * chance, exactly the gap tutorial-interactive.json's own `set_policy
 * mode:continuous` step means to close ("protects the crew through the grind
 * that follows") but silently didn't for whichever employee(s) end up
 * waiting idle rather than working through it. shouldForceRest itself then
 * decides, per SitePolicy's rules: a full shift under a timed mode
 * (shift_8h/shift_12h — moot for a genuinely idle employee, since
 * incrementWorkTick only advances ticksWorked while activeActionId !== null,
 * so an idle employee's ticksWorked is whatever it was when they last went
 * idle, not accruing further), or fatigue at or below its effective
 * threshold (custom-mode per-employee overrides via getEffectiveThresholds)
 * for every mode including continuous/custom.
 *
 * Unlike the legacy function (fixed SHIFT_SLEEP_DURATION_TICKS, tier>=2
 * only), this routes to the nearest living_quarters of ANY tier
 * (findNearestLivingQuarters is already tier-unfiltered), and sets
 * pendingRestNeedKey so
 * completion routes through the general tickGeneralRestCompletion /
 * completeRestForEmployee path (NEED_REST_DURATIONS-based duration,
 * BUILDING_REPLENISH_RATES-based replenishment, NEED_REST_NO_BUILDING_CAP
 * when resting in place) instead of processShiftCycle's own completeRestTick.
 */
export function forceShiftRestIfNeededByPolicy(
  state: GameState,
  emp: Employee,
  firedEvents: FiredEvent[],
  shiftRested: number[],
  _emitter?: EventEmitter,
): void {
  if (emp.restTicksRemaining !== null) return;
  // Already walking to a queued rest — see forceShiftRestIfNeeded's own
  // comment on the same check (#437).
  if (emp.pendingRestDuration !== null) return;
  // Already walking to a claimed task, not yet arrived — mirrors the
  // pendingRestDuration guard above for the task-travel case (#928), and
  // mirrors forceShiftRestIfNeeded's own identical stuck-walk exemption
  // (see its own comment on the same check) for the same reason.
  if (emp.pendingTaskDuration !== null && !emp.isMoveStuck) return;
  // Already arrived and mid-execution of a boarded vehicle-gated action
  // (e.g. dig_ramp_segment — #945; see isMidVehicleGatedWork's own doc
  // comment, VehicleReservation.ts, for why this is scoped to vehicle-gated
  // work rather than every in-progress task). Interrupting mid-execution
  // forces a dismount and a fresh walk-and-reboard once the rest ends,
  // instead of letting the driver finish this segment (or hand off cleanly
  // via same-vehicle continuity to the next one) first.
  //
  // Deliberately does NOT also cover the mid-drive-to-target phase (taskTicksRemaining
  // still null) — unlike the mid-execution case above, a long initial approach
  // drive protected the same way just defers the same crossing to
  // tickCollapse's unconditional hard floor instead of this policy's own
  // proactive one, trading a healthy rest at the policy's threshold for a
  // drive-to-zero collapse with no net reduction in how many times the
  // vehicle gets boarded (confirmed empirically against #945's own tutorial
  // box-cut repro below: identical boardingCount either way, but fatigue
  // bottoming out at 0 instead of recovering at the policy's own threshold).
  // #922's own VehicleReservation.test.ts already pins mid-drive
  // interruption as intended behavior for the legacy (non-policy)
  // forceShiftRestIfNeeded — this mirrors that scope for the policy path too.
  if (emp.taskTicksRemaining !== null && isMidVehicleGatedWork(state, emp)) return;
  // Mid-walk to board a vehicle from a manual `vehicle driver` command —
  // see this function's own doc comment above (#707).
  if (emp.pendingDriverVehicleId !== null) return;
  // Mid-evacuation-walk (isMidEvacuationWalk — see its own doc comment,
  // Evacuation.ts, #557): without this, the #707 "genuinely idle" branch
  // below would read them as free to reassign and overwrite the evacuation
  // destination with a walk back toward a living_quarters, possibly right
  // back inside the danger zone they were just ordered out of.
  if (isMidEvacuationWalk(emp)) return;

  const snapshot = {
    id: emp.id, fatigue: emp.fatigue, ticksWorked: emp.ticksWorked,
  };
  if (!shouldForceRest(state.sitePolicy, snapshot, true)) return;

  // #678 follow-up: release the action this employee was actively working
  // (a drill_hole, dig_ramp_segment, or any other vehicle-gated task) back to
  // the pool before handing activeActionId to the rest action below — mirrors
  // tickCollapse's own interruptActiveAction call for the identical reason.
  // Without this, overwriting activeActionId directly (as this function used
  // to) orphans the interrupted action: its record stays 'assigned'/holderId
  // === emp.id forever, so it is never completed (this employee is now
  // resting, not ticking it) and never reclaimed (fillIdleEmployeeFromQueueOrPool's
  // open-pool query only matches 'queued' actions) — the employee goes idle
  // permanently once the forced rest ends, and the work they were doing never
  // finishes. interruptActiveAction preserves the in-progress payload
  // (remaining duration, vehicle reservation released) so the same or another
  // qualified employee resumes it later instead of restarting from scratch.
  // #707: a genuinely idle employee (activeActionId already null) has
  // nothing to interrupt — interruptActiveAction(state, emp, null) is a safe
  // no-op in that case (TaskDispatch.ts), so this call is unconditional here
  // rather than gated on activeActionId !== null.
  const priorActionId = emp.activeActionId;
  interruptActiveAction(state, emp, priorActionId);

  // Single gauge now (#928) — fatigue is the only need this policy ever
  // routes a rest for, whether the rest was need-triggered or shift-
  // duration-triggered.
  const needKey: NeedKey = 'fatigue';

  // Find nearest living_quarters of any tier for target coordinates.
  const building = findNearestLivingQuarters(state, emp.x, emp.z);
  let targetX = emp.x;
  let targetZ = emp.z;
  let buildingId: number | undefined;
  const restDuration = NEED_REST_DURATIONS[needKey];

  if (building) {
    const approach = resolveBuildingApproach(state, building, emp.x, emp.z);
    targetX = approach.x;
    targetZ = approach.z;
    buildingId = building.id;
  }
  // #678 follow-up: unlike tickCollapse/autoInsertNeedTasks (which still
  // apply NEED_REST_NO_BUILDING_DURATION_MULTIPLIER when resting in place —
  // that multiplier is calibrated against genuine depletion, encouraging a
  // living_quarters build), a policy-forced rest never doubles for lacking
  // one. The policy's whole premise (its own doc comment above: "a tier-1
  // living_quarters, or no building at all, is a valid rest destination
  // under a policy, not a disqualifier") is that applying it protects an
  // employee regardless of site infrastructure — every SitePolicy.shouldForceRest
  // trigger, need-crossed or shift-duration-elapsed alike, already costs
  // real, un-doubled ticks against whatever queued work it interrupts
  // (interruptActiveAction above), which is real leverage for building a
  // living_quarters (shorter walk, same duration) without also taxing an
  // early, infrastructure-light site (exactly what tutorial_pit's own
  // scripted tutorial is — no living_quarters exists there at all) twice
  // for the one condition the policy exists to make survivable in the
  // first place. tests/unit/engine/ShiftCycle.test.ts's own "no living_quarters
  // at all" case documents this — previously pinned to the doubled value.

  // The rest timer itself does not start until ArrivalGate.tickArrivalGate
  // confirms the employee has walked to the building (#437).
  emp.pendingRestDuration = restDuration;
  emp.pendingRestNeedKey = needKey;

  // Immediately claimed — status/holderId reflect that from creation (#547).
  const restAction = createRestPendingAction(state, {
    targetX,
    targetZ,
    targetEmployeeId: emp.id,
    payload: { needKey, triggeredBy: 'shift_cycle_policy', buildingId },
  }, emp.id);

  finishForceRest(state, emp, restAction, firedEvents, shiftRested, _emitter);
}
