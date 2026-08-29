// BlastSimulator2026 — Evacuation-hold bookkeeping (#557)
// How an action evacuateZone (Evacuation.ts) interrupted is shielded from
// being reclaimed and walked straight back into the zone before it has
// genuinely resolved. Split out of Evacuation.ts as part of a #557 follow-up
// file-size split; Evacuation.ts re-exports the three symbols external
// callers need, so it stays the single public surface for evacuation-related
// imports elsewhere (EmployeeDispatch.ts, EmployeeDispatchSteps.ts).

import type { GameState, PendingAction } from '../state/GameState.js';
import type { ZoneBounds } from '../entities/Zone.js';
import { isInZone, isZoneClearOfEmployees, isZoneStillBlastThreatened } from '../entities/Zone.js';
import { releaseActionToOpenPool } from './TaskCancellation.js';
import { completePendingAction } from './TaskLifecycleCore.js';
import type { Employee } from '../entities/Employee.js';

/**
 * PendingAction.payload key evacuateZone stamps on any action it interrupts
 * whose own target falls inside the zone being evacuated (#557) — whether
 * interruptActiveAction's relay re-targeted it back at the same employee (an
 * action claimed but not yet started, TaskCancellation.ts's own re-target
 * branch) or left it in the open pool untouched (an action already
 * mid-progress — taskTicksRemaining > 0 — takes interruptActiveAction's other
 * branch instead, which never touches targetEmployeeId). Dispatch
 * (isEvacuationHoldActive below, checked from EmployeeDispatchSteps.ts's
 * claimActionsTargetedAtEmployee and claimOnePoolCandidate filters) refuses to
 * reclaim a so-marked action while the zone it was interrupted in is still
 * active and not yet clear — otherwise either the relay hands the action
 * right back to the just-evacuated employee, or (the case the mid-progress
 * branch needs covering too) it sits in the open pool and gets picked up by
 * whichever qualified employee goes idle first — including, confirmed live
 * via tutorial-interactive.json's `wait_until dangerZoneClear`, the very
 * employee who just finished evacuating, the instant they arrive at their
 * own safe cell. Either way the target walks someone straight back into the
 * danger zone.
 *
 * Deliberately NOT a blanket "any pending action whose target falls in any
 * zone" rule evaluated fresh at claim time: `state.zone.activeZone` has no
 * way to become null again once set (defineZone only ever assigns it), so a
 * zone a player drew once, for an entirely unrelated reason (site-prep
 * clearing well before any blast plan exists — confirmed live via
 * safety-projection-visual.json's own `zone clear` step, issued before its
 * drill_plan even runs), stays "active" for the rest of the session. A rule
 * like that would also catch every ordinary future action — a building
 * ordered long after this evacuation completed, still sitting inside the
 * same old footprint — for as long as anyone is legitimately working inside
 * it, permanently blocking work the zone was cleared FOR. Stamping only the
 * specific actions THIS evacuateZone call itself interrupted avoids that
 * false-positive entirely: the marker is set once, only on actions that
 * existed at this exact moment, never re-evaluated against a fresh action's
 * geography later.
 */
export const EVACUATION_HOLD_KEY = 'evacuationHold';

/**
 * Pure check: true when `action` is still evacuation-hold-blocked — carries
 * EVACUATION_HOLD_KEY and the zone it was interrupted in has not yet
 * genuinely resolved. "Resolved" is two conditions, both required (see
 * Zone.ts's isZoneStillBlastThreatened for why the second one was added on
 * top of the original, employee-occupancy-only check, #557 follow-up):
 *  1. Clear of living employees — isZoneClearOfEmployees, not the broader
 *     isZoneClear: a vehicle alone left inside — including one permanently
 *     stranded — must never block this forever.
 *  2. No live, un-fired blast plan still threatens this exact footprint.
 *
 * Called from EmployeeDispatchSteps.ts's claimActionsTargetedAtEmployee and
 * claimOnePoolCandidate .filter() predicates, so this never mutates
 * `action` or any other state — a reader has no reason to expect a
 * .filter() predicate to have side effects. The one-shot marker removal
 * that used to happen inline here (stripping EVACUATION_HOLD_KEY the moment
 * the zone reads clear) is clearResolvedEvacuationHolds below instead,
 * called once per tick from tickEmployees rather than implicitly from
 * inside a filter (#557 review).
 */
export function isEvacuationHoldActive(state: GameState, action: PendingAction): boolean {
  if (action.payload[EVACUATION_HOLD_KEY] !== true) return false;
  const zone = state.zone.activeZone;
  if (zone === null) return false;
  if (!isZoneClearOfEmployees(zone, state.employees)) return true;
  return isZoneStillBlastThreatened(state.drillHoles, zone);
}

/**
 * One-shot cleanup: strips EVACUATION_HOLD_KEY from every PendingAction that
 * still carries it, once the zone it was interrupted in has genuinely
 * resolved — see isEvacuationHoldActive's own doc comment for the two
 * conditions this mirrors. Without this, the marker would sit on the action
 * forever — `state.zone.activeZone` never becomes null again once set
 * (defineZone only ever assigns it), so a LATER, ordinary re-entry into the
 * same footprint (post-blast debris cleanup, say) would make
 * isEvacuationHoldActive read the zone as occupied again and re-arm a block
 * on an action with no remaining connection to the evacuation that created
 * it — confirmed live via site-expansion.json, where a cleanup trip kept an
 * unrelated building order hold-blocked forever.
 *
 * Called once per tick (tickEmployees, EmployeeDispatch.ts) rather than
 * lazily from inside isEvacuationHoldActive's own .filter() call sites — see
 * that function's own doc comment for why the mutation moved out of the
 * pure check. A no-op tick (no active zone, the zone not yet clear of
 * employees, a live blast plan still threatens it, or nothing left carrying
 * the marker) touches nothing.
 */
export function clearResolvedEvacuationHolds(state: GameState): void {
  const zone = state.zone.activeZone;
  if (zone === null) return;
  if (!isZoneClearOfEmployees(zone, state.employees)) return;
  if (isZoneStillBlastThreatened(state.drillHoles, zone)) return;

  for (const action of state.pendingActions) {
    if (action.payload[EVACUATION_HOLD_KEY] !== true) continue;
    const { [EVACUATION_HOLD_KEY]: _removed, ...rest } = action.payload;
    action.payload = rest;
  }
}

/**
 * Discards `actionId` — an employee's just-interrupted 'rest' action whose
 * OWN target sits inside the zone being evacuated — instead of letting it
 * survive the interrupt as a held, reclaimable action (Evacuation.ts's
 * evacuateZone calls interruptActiveAction just before this, which already
 * released it to 'queued' with that same pre-evacuation target intact).
 *
 * A 'rest' action's targetX/targetZ is resolved exactly once, at creation
 * (createRestPendingAction, via findNearestBuildingOfType/
 * resolveBuildingApproach — RestActionHelpers.ts), and never again: reclaiming
 * an existing action (promoteActionToActive, EmployeeDispatchSteps.ts) reuses
 * whatever target it already carries rather than re-resolving one. A rest
 * request created (or, degraded case, already granted #707-idle-eligible)
 * before this zone existed has no way to know its own living_quarters is
 * about to become off-limits — findNearestBuildingOfType's own zone exclusion
 * (RestActionHelpers.ts, #557) only ever runs at CREATION time, so it cannot
 * retroactively steer an already-created action away from a target that only
 * turned dangerous after the fact. Confirmed live via
 * tutorial-interactive.json: EVACUATION_HOLD_KEY correctly held such an
 * action until the zone read clear of employees, then dispatch reclaimed it
 * as-is and walked the just-evacuated employee straight back to the exact
 * living_quarters approach cell they had just left, using a target baked in
 * tick(s) before the zone was ever drawn.
 *
 * Discarding is safe specifically for 'rest': the need that requested it
 * (hunger/fatigue) is untouched by any of this — clearing pendingRestDuration/
 * pendingRestNeedKey/restTicksRemaining below (none of which
 * interruptActiveAction's clearHolderWalkFields/clearActiveTaskFields ever
 * touch, since those predate rest-mode fields entirely) just makes the
 * employee eligible again for tickNeedRestoration/tickCollapse/
 * forceShiftRestIfNeededByPolicy to create a FRESH rest action once idle —
 * one that resolves its target fresh, through the now-populated
 * `state.zone.activeZone`, so findNearestBuildingOfType's own exclusion
 * finally applies and routes to a safe rest-in-place instead. Leaving any of
 * those three fields non-null here would instead permanently block that
 * re-entry (every one of those three functions' own early-return guards
 * checks pendingRestDuration/restTicksRemaining first) — silently starving
 * this employee's needs for the rest of the session.
 *
 * Never applied to any other action type: an interrupted dig_ramp_segment,
 * survey, or haul is still the same valid work once the zone genuinely
 * clears — nothing about its target goes stale the way a rest's does, so
 * "resume, don't restart" (interruptActiveAction's own default) remains
 * correct for it.
 */
export function discardStaleRestAction(state: GameState, emp: Employee, actionId: number): void {
  completePendingAction(state, actionId);
  emp.pendingRestDuration = null;
  emp.pendingRestNeedKey = null;
  emp.restTicksRemaining = null;
}

/**
 * Releases every entry in `emp.taskQueue` whose OWN target sits inside `zone`
 * back to the open pool (or, for a 'rest' entry, discards it — see
 * discardStaleRestAction's own doc comment) — the second, independent claim
 * an employee can be holding on evacuation-relevant work that evacuateZone's
 * per-employee loop (interruptActiveAction on `emp.activeActionId` alone)
 * never reaches.
 *
 * `claimActionsTargetedAtEmployee` (EmployeeDispatchSteps.ts) claims a
 * targeted action — status 'assigned', holderId === emp.id — the moment it
 * sees one, even while the employee is still busy with something else: the
 * first such claim while idle is promoted straight to activeActionId, but
 * every one after that (up to MAX_EMPLOYEE_TASK_QUEUE_DEPTH) is pushed onto
 * `taskQueue` instead, un-promoted, with no walk ever started toward it. That
 * claim is real — the action is 'assigned', not 'queued' — so evacuateZone's
 * own blanket queued-action stamping loop never sees it either
 * (`action.status !== 'queued'` skips it). Left alone, it survives evacuation
 * completely untouched: the moment its holder finishes their OWN evacuation
 * walk and goes idle, `fillIdleEmployeeFromQueueOrPool`
 * (EmployeeDispatchSteps.ts) finds it still sitting in taskQueue, already
 * theirs, and promotes it immediately — no EVACUATION_HOLD_KEY ever stood in
 * the way, because it was never 'queued' at the moment evacuateZone ran to
 * stamp one. Confirmed live via tutorial-interactive.json: a dig_ramp_segment
 * action claimed into an employee's taskQueue (its vehicle reserved —
 * VehicleReservation.ts's reservedForActionId — but not yet boarded, driverId
 * still null) survived evacuation, then sent that employee straight back into
 * the zone the instant they arrived at their own safe cell — the vehicle
 * itself meanwhile stuck at its pre-evacuation position the whole time
 * (reservedForActionId !== null with driverId === null satisfies neither
 * tick.ts step 8f's plain-movement gate nor ArrivalGate.ts's vehicle-gated
 * one), so `dangerZoneClear` (which — unlike this hold mechanism's own
 * isZoneClearOfEmployees — also checks vehicles) could not have read true
 * regardless of the employee's own fate.
 *
 * Releasing via releaseActionToOpenPool (TaskCancellation.ts) — not
 * interruptActiveAction — because there is no walking/task-claim state on
 * `emp` to unwind for an entry that was never promoted: interruptActiveAction's
 * extra work (interruptedActionPayload stashing, destinationX/Z clearing,
 * durationTicks preservation) all exist for the ONE action `emp` was actively
 * walking/working, which this never was.
 */
export function releaseInZoneTaskQueueEntries(state: GameState, emp: Employee, zone: ZoneBounds): void {
  if (emp.taskQueue.length === 0) return;

  const kept: number[] = [];
  for (const actionId of emp.taskQueue) {
    const action = state.pendingActions.find(a => a.id === actionId);
    // Gone already (completed/removed through some other path this same
    // tick) or targets somewhere outside the zone — nothing to release,
    // stays queued for this employee to resume once idle, same as today.
    if (action === undefined) continue;
    if (!isInZone(action.targetX, action.targetZ, zone)) {
      kept.push(actionId);
      continue;
    }

    if (action.type === 'rest') {
      completePendingAction(state, actionId);
    } else {
      releaseActionToOpenPool(state, action);
    }
  }
  emp.taskQueue = kept;
}
