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
import { EVACUATION_CLEARANCE_M } from '../config/balance.js';

/**
 * PendingAction.payload key evacuateZone stamps on any action it interrupts
 * whose own target falls inside the zone being evacuated (#557) — whether
 * interruptActiveAction's relay re-targeted it back at the same employee (an
 * action claimed but not yet started, TaskCancellation.ts's own re-target
 * branch) or left it in the open pool untouched (an action already
 * mid-progress — taskTicksRemaining > 0 — takes interruptActiveAction's other
 * branch instead, which never touches targetEmployeeId). Dispatch
 * (EmployeeDispatchSteps.ts's isEvacuationHoldBlocked, checked by both
 * claimActionsTargetedAtEmployee and claimOnePoolCandidate) refuses to
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
      // interruptActiveAction always leaves the action 'queued' (whether
      // TaskCancellation's relay re-targeted it back at `emp.id` or left it
      // in the open pool untouched) — the blanket 'queued'-action stamping
      // loop below picks it up from there, so no separate stamp is needed
      // here.
      interruptActiveAction(state, emp, actionId);
    }
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
  // genuinely held by someone outside the zone, or will be caught by the
  // per-employee loop above if that holder is inside it) at the exact moment
  // THIS evacuateZone call runs, same "existed at this moment, never
  // re-evaluated later" scoping EVACUATION_HOLD_KEY's own doc comment
  // describes for why this isn't the blanket rule that doc comment rules out.
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
