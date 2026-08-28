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
 * PendingAction.payload key evacuateZone stamps on an action interruptActiveAction
 * just re-targeted back at the employee it interrupted (#557). Dispatch
 * (EmployeeDispatchSteps.ts's isEvacuationHoldBlocked) refuses to reclaim a
 * so-marked action while the zone it was interrupted in is still active and
 * not yet clear — otherwise the relay hands the action right back to the
 * just-evacuated employee the instant they go idle at the safe cell, walking
 * them straight back into the danger zone.
 *
 * Deliberately NOT a blanket "any targeted action whose target falls in any
 * zone" rule: `state.zone.activeZone` has no way to become null again once
 * set (defineZone only ever assigns it), so a zone a player drew once, for
 * an entirely unrelated reason (site-prep clearing well before any blast
 * plan exists — confirmed live via safety-projection-visual.json's own
 * `zone clear` step, issued before its drill_plan even runs), stays "active"
 * for the rest of the session. A blanket rule permanently blocked every
 * ordinary needs-driven interruption (a proactive rest mid-walk) whose
 * target happened to sit in that old footprint — the drill/charge work the
 * zone was cleared FOR could then never resume, since the zone reads
 * "occupied" for as long as anyone is legitimately working inside it.
 * Scoping the check to only actions THIS evacuation itself re-targeted
 * avoids that false-positive entirely, while still closing the real relay
 * bug this exists for.
 */
export const EVACUATION_HOLD_KEY = 'evacuationHold';

/**
 * Candidate safe destinations for an entity at (fromX, fromZ) evacuating
 * `zone`: the projection past the zone's nearest edge (the shortest way out),
 * then the zone's four corners (each pushed out by EVACUATION_CLEARANCE_M) as
 * fallbacks when the nearest-edge point is blocked or unreachable.
 */
function buildCandidates(fromX: number, fromZ: number, zone: ZoneBounds): EvacuationDestination[] {
  const distLeft = fromX - zone.x1;
  const distRight = zone.x2 - fromX;
  const distTop = fromZ - zone.z1;
  const distBottom = zone.z2 - fromZ;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  let nearestEdge: EvacuationDestination;
  if (minDist === distLeft) {
    nearestEdge = { x: zone.x1 - EVACUATION_CLEARANCE_M, z: fromZ };
  } else if (minDist === distRight) {
    nearestEdge = { x: zone.x2 + EVACUATION_CLEARANCE_M, z: fromZ };
  } else if (minDist === distTop) {
    nearestEdge = { x: fromX, z: zone.z1 - EVACUATION_CLEARANCE_M };
  } else {
    nearestEdge = { x: fromX, z: zone.z2 + EVACUATION_CLEARANCE_M };
  }

  const corners: EvacuationDestination[] = [
    { x: zone.x1 - EVACUATION_CLEARANCE_M, z: zone.z1 - EVACUATION_CLEARANCE_M },
    { x: zone.x2 + EVACUATION_CLEARANCE_M, z: zone.z1 - EVACUATION_CLEARANCE_M },
    { x: zone.x1 - EVACUATION_CLEARANCE_M, z: zone.z2 + EVACUATION_CLEARANCE_M },
    { x: zone.x2 + EVACUATION_CLEARANCE_M, z: zone.z2 + EVACUATION_CLEARANCE_M },
  ];

  return [nearestEdge, ...corners].map(c => ({ x: Math.round(c.x), z: Math.round(c.z) }));
}

/**
 * Finds the nearest navigable cell outside `zone` (and clear of it by
 * EVACUATION_CLEARANCE_M) reachable from (fromX, fromZ). Returns null when
 * no safe cell can be reached.
 *
 * With no NavGrid built yet, returns the first (nearest-edge) candidate
 * unconditionally — the same "nothing to route around, so nothing blocks the
 * direct destination" fallback EntityMovementTick.ts's tickEmployeeMovement/
 * tickVehicle already use when state.navGrid is null.
 */
export function findSafeEvacuationCell(
  state: GameState, fromX: number, fromZ: number, zone: ZoneBounds,
): EvacuationDestination | null {
  const candidates = buildCandidates(fromX, fromZ, zone);

  if (!state.navGrid) return candidates[0]!;

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
      interruptActiveAction(state, emp, actionId);
      // interruptActiveAction's own "re-target the same employee if not yet
      // arrived" relay (TaskCancellation.ts) may have just set this action's
      // targetEmployeeId back to `emp.id` — the exact condition
      // EVACUATION_HOLD_KEY exists to catch, scoped to only actions THIS
      // evacuation itself re-targeted (see the constant's own doc comment
      // for why this can't be a blanket "any zone, any interruption" rule).
      const action = state.pendingActions.find(a => a.id === actionId);
      if (action && action.targetEmployeeId === emp.id && isInZone(action.targetX, action.targetZ, zone)) {
        action.payload = { ...action.payload, [EVACUATION_HOLD_KEY]: true };
      }
    }
  }

  for (const vehicle of state.vehicles.vehicles) {
    if (!isInZone(vehicle.x, vehicle.z, zone)) continue;
    if (vehicle.haulingPhase !== null) abortHaul(vehicle);
    if (vehicle.breakPhase !== null) abortBreak(vehicle);
  }

  return clearZone(
    zone,
    state.vehicles,
    state.employees,
    (fromX, fromZ, z) => findSafeEvacuationCell(state, fromX, fromZ, z),
  );
}
