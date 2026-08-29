// BlastSimulator2026 — Zone evacuation orchestration
// Finds safe destinations for entities standing inside a blast danger zone
// and routes them out before the blast fires (#557).

import type { GameState } from '../state/GameState.js';
import type { ZoneBounds, EvacuationDestination, EvacuationResult } from '../entities/Zone.js';
import { clearZone, isInZone } from '../entities/Zone.js';
import { findPath } from '../nav/Pathfinding.js';
import { interruptActiveAction } from './TaskCancellation.js';
import { abortHaul } from '../economy/HaulingTask.js';
import { abortBreak } from '../economy/BoulderBreaking.js';
import type { Employee } from '../entities/Employee.js';
import { EVACUATION_CLEARANCE_M } from '../config/balance.js';
import {
  EVACUATION_HOLD_KEY, discardStaleRestAction, releaseInZoneTaskQueueEntries,
} from './EvacuationHold.js';

// Re-exported so EmployeeDispatch.ts/EmployeeDispatchSteps.ts keep importing
// evacuation-hold bookkeeping from this one file — the split into
// EvacuationHold.ts (#557 follow-up file-size split) is an internal
// organization detail, not a change to who imports what. See
// EvacuationHold.ts for EVACUATION_HOLD_KEY's own doc comment and both
// functions'.
export { EVACUATION_HOLD_KEY, isEvacuationHoldActive, clearResolvedEvacuationHolds } from './EvacuationHold.js';

/**
 * True when `employee` is currently walking a route the claim system knows
 * nothing about: destinationX/Z set directly by an evacuation order
 * (evacuateZone below, via Zone.ts's clearZone) rather than through a
 * claimed PendingAction, so there is no activeActionId behind the walk at
 * all. An employee in this state reads as "idle" to any check that only
 * looks at activeActionId === null, and treating them as idle lets ordinary
 * dispatch/rest-routing reassign or overwrite the evacuation destination
 * before the employee ever takes a step — including, for an employee just
 * evacuated FROM the area around the nearest building/action, routing them
 * right back inside the danger zone they were just ordered out of (#557).
 *
 * Five call sites guard on this, each skipping its own claim/reroute logic
 * while it is true: EmployeeDispatch.ts's tickEmployees,
 * NeedRestoration.ts's tickNeedRestoration and tickCollapse,
 * ForceShiftRest.ts's forceShiftRestIfNeededByPolicy, and
 * NeedTaskInsertion.ts's autoInsertNeedTasks (#557 follow-up — the odd one
 * out: unlike the other four, it doesn't self-claim, so a missed guard here
 * doesn't touch activeActionId/destinationX at all while the walk is still
 * in flight. It queues a self-targeted 'rest' action instead, snapshotting
 * targetX/targetZ from wherever the employee physically stands at that
 * exact moment — still inside the danger zone through most of the walk —
 * and leaves it unclaimed. That queued action is invisible to
 * evacuateZone's own one-shot EVACUATION_HOLD_KEY sweep, which only stamps
 * actions that already exist at the moment evacuation is ordered: this one
 * is created many ticks later. It sits harmlessly queued for as long as
 * isMidEvacuationWalk reads true, then — the instant the employee genuinely
 * arrives and destinationX clears — ordinary dispatch claims it exactly
 * like any other self-targeted action and walks the employee straight back
 * to the stale, still-dangerous coordinates it was created with). Dispatch
 * resumes for the employee the very next tick either way, once they've
 * arrived and destinationX clears (or, for a manual vehicle-boarding walk,
 * the analogous pendingDriverVehicleId guard each site already carries
 * separately).
 */
export function isMidEvacuationWalk(employee: Employee): boolean {
  return employee.activeActionId === null && employee.destinationX !== null;
}

/**
 * isInZone (Zone.ts) is inclusive at the boundary (>=/<=), so a candidate
 * pushed out by exactly EVACUATION_CLEARANCE_M lands ON the padded zone's
 * edge and still reads as "inside" it. One extra metre puts the candidate
 * strictly beyond the margin instead of merely touching it.
 */
const EVACUATION_CANDIDATE_OFFSET_M = EVACUATION_CLEARANCE_M + 1;

/**
 * Candidate safe destinations for an entity at (fromX, fromZ) evacuating
 * `zone`: the projection past the zone's nearest edge (the shortest way out),
 * then the zone's four corners (each pushed out by more than
 * EVACUATION_CLEARANCE_M, see EVACUATION_CANDIDATE_OFFSET_M) as fallbacks
 * when the nearest-edge point is blocked or unreachable.
 */
function buildCandidates(fromX: number, fromZ: number, zone: ZoneBounds): EvacuationDestination[] {
  const distLeft = fromX - zone.x1;
  const distRight = zone.x2 - fromX;
  const distTop = fromZ - zone.z1;
  const distBottom = zone.z2 - fromZ;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  let nearestEdge: EvacuationDestination;
  if (minDist === distLeft) {
    nearestEdge = { x: zone.x1 - EVACUATION_CANDIDATE_OFFSET_M, z: fromZ };
  } else if (minDist === distRight) {
    nearestEdge = { x: zone.x2 + EVACUATION_CANDIDATE_OFFSET_M, z: fromZ };
  } else if (minDist === distTop) {
    nearestEdge = { x: fromX, z: zone.z1 - EVACUATION_CANDIDATE_OFFSET_M };
  } else {
    nearestEdge = { x: fromX, z: zone.z2 + EVACUATION_CANDIDATE_OFFSET_M };
  }

  const corners: EvacuationDestination[] = [
    { x: zone.x1 - EVACUATION_CANDIDATE_OFFSET_M, z: zone.z1 - EVACUATION_CANDIDATE_OFFSET_M },
    { x: zone.x2 + EVACUATION_CANDIDATE_OFFSET_M, z: zone.z1 - EVACUATION_CANDIDATE_OFFSET_M },
    { x: zone.x1 - EVACUATION_CANDIDATE_OFFSET_M, z: zone.z2 + EVACUATION_CANDIDATE_OFFSET_M },
    { x: zone.x2 + EVACUATION_CANDIDATE_OFFSET_M, z: zone.z2 + EVACUATION_CANDIDATE_OFFSET_M },
  ];

  return [nearestEdge, ...corners].map(c => ({ x: Math.round(c.x), z: Math.round(c.z) }));
}

/**
 * Finds the nearest navigable cell outside `zone` (and clear of it by
 * EVACUATION_CLEARANCE_M) reachable from (fromX, fromZ). Returns null when
 * no safe cell can be reached.
 *
 * With no NavGrid built yet, reachability cannot be verified at all — unlike
 * EntityMovementTick.ts's direct-walk fallback (moving toward an explicit
 * target the caller already chose), here the destination itself is a guess
 * this function is making. Guessing a safe cell without anything to route
 * across it is exactly the "silently stranded" failure #557 calls out, so
 * this returns null instead of the first geometric candidate.
 */
export function findSafeEvacuationCell(
  state: GameState, fromX: number, fromZ: number, zone: ZoneBounds,
): EvacuationDestination | null {
  if (!state.navGrid) return null;

  const candidates = buildCandidates(fromX, fromZ, zone);

  for (const candidate of candidates) {
    const cell = state.navGrid.cellAt(candidate.x, candidate.z);
    if (!cell || cell.type === 'blocked' || cell.type === 'void') continue;

    const path = findPath(state.navGrid, {
      agentId: -1,
      fromX, fromZ,
      toX: candidate.x, toZ: candidate.z,
      avoidVehicles: false,
    });
    if (path.found) return candidate;
  }

  return null;
}

/**
 * Evacuates every vehicle and employee standing inside `zone`, routing each
 * to a safe destination found via findSafeEvacuationCell. Entities with no
 * reachable safe cell are reported as stranded rather than moved.
 *
 * Order matters: every alive, in-zone employee's active action is
 * interrupted (releasing its walk/task-claim fields, including destinationX/
 * Z) BEFORE clearZone runs — clearZone is what sets the real evacuation
 * destination, and interruptActiveAction would stomp it if run after.
 * Likewise, a vehicle mid-haul or mid-break is driven by HaulingTask.ts's/
 * BoulderBreaking.ts's own phase loops rather than the generic mover, so its
 * phase is aborted first — otherwise clearZone's moveVehicle call stages a
 * target the tick loop never advances toward (see EntityMovementTick.ts's
 * tickVehicle-skip condition on haulingPhase/reservedForActionId).
 */
export function evacuateZone(state: GameState, zone: ZoneBounds): EvacuationResult {
  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    if (!isInZone(emp.x, emp.z, zone)) continue;

    const actionId = emp.activeActionId;
    if (actionId !== null) {
      // Captured before interruptActiveAction mutates it (which flips status
      // to 'queued' and can re-target it) — see discardStaleRestAction's own
      // doc comment (EvacuationHold.ts) for why a 'rest' action with an
      // in-zone target must be discarded outright rather than left to
      // survive the interrupt.
      const action = state.pendingActions.find(a => a.id === actionId);
      const isStaleRest = action !== undefined && action.type === 'rest'
        && isInZone(action.targetX, action.targetZ, zone);

      // interruptActiveAction always leaves the action 'queued' (whether
      // TaskCancellation's relay re-targeted it back at `emp.id` or left it
      // in the open pool untouched) — the blanket 'queued'-action stamping
      // loop below picks it up from there, so no separate stamp is needed
      // here.
      interruptActiveAction(state, emp, actionId);

      if (isStaleRest) discardStaleRestAction(state, emp, actionId);
    }

    // A second, independent claim an evacuated employee can be carrying:
    // up to MAX_EMPLOYEE_TASK_QUEUE_DEPTH-1 further actions already claimed
    // (status 'assigned', holderId === emp.id) but not yet promoted to
    // activeActionId — EmployeeDispatchSteps.ts's claimActionsTargetedAtEmployee
    // pushes onto taskQueue instead of promoting when the employee was
    // already busy the tick it claimed them. See
    // releaseInZoneTaskQueueEntries' own doc comment (EvacuationHold.ts) for
    // why the loop above never reaches these.
    releaseInZoneTaskQueueEntries(state, emp, zone);
  }

  for (const vehicle of state.vehicles.vehicles) {
    if (!isInZone(vehicle.x, vehicle.z, zone)) continue;
    if (vehicle.haulingPhase !== null) abortHaul(vehicle);
    if (vehicle.breakPhase !== null) abortBreak(vehicle);
  }

  // Stamp every already-queued, unheld action (targetEmployeeId === null or
  // not — either way nobody is actively walking it right now) whose own
  // target sits inside the zone, on top of the per-employee interruption loop
  // above. An action can land in the open pool long before this specific
  // evacuation call — a ramp segment interrupted by an entirely earlier
  // collapse/rest cycle, say — and sit there queued, unclaimed, for the rest
  // of the session; the interruption loop above only ever sees an action that
  // was THIS tick's activeActionId for someone currently in the zone, so it
  // never touches one that was already idle in the pool. Without this,
  // dispatch (EmployeeDispatchSteps.ts) claims it exactly like ordinary
  // ready work the instant anyone goes idle — including the very employee
  // who just finished evacuating, the moment they reach their own safe cell —
  // and walks them right back into the zone being cleared. Scoped to actions
  // that are 'queued' (not 'assigned'/'in_progress' — those are still
  // genuinely held by someone outside the zone, or will already have been
  // released back to 'queued' by the per-employee loop above — activeActionId
  // via interruptActiveAction, a taskQueue entry via
  // releaseInZoneTaskQueueEntries — if that holder is inside the zone) at the
  // exact moment THIS evacuateZone call runs, same "existed at this moment, never
  // re-evaluated later" scoping EVACUATION_HOLD_KEY's own doc comment
  // (EvacuationHold.ts) describes for why this isn't the blanket rule that
  // doc comment rules out.
  for (const action of state.pendingActions) {
    if (action.status !== 'queued') continue;
    if (!isInZone(action.targetX, action.targetZ, zone)) continue;
    action.payload = { ...action.payload, [EVACUATION_HOLD_KEY]: true };
  }

  return clearZone(
    zone,
    state.vehicles,
    state.employees,
    (fromX, fromZ, z) => findSafeEvacuationCell(state, fromX, fromZ, z),
  );
}
