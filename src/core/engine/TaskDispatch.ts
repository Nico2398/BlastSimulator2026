// BlastSimulator2026 — Task Dispatch engine
// Routes pending actions to qualified employees.

import { isFootprintAction, type GameState, type GhostPreview, type PendingAction } from '../state/GameState.js';
import { classifyNewOrder } from './OrderReachability.js';
import { holdsRequiredSkill, type Employee } from '../entities/Employee.js';

export type { PendingAction };

export { clearActiveTaskFields, completePendingAction, completeIfOwnedRestAction } from './TaskLifecycleCore.js';
export { cancelAction, interruptActiveAction, releaseDeadEmployeeActions, releaseInjuredEmployeeQueue, releaseInjuredEmployeesQueues } from './TaskCancellation.js';
export type { CancelActionResult } from './TaskCancellation.js';

/**
 * Distinguishes *why* dispatch rejected, beyond the generic `error: 'unqualified'`
 * kept for backward compatibility. Callers that need to phrase an accurate
 * rejection message (e.g. the console `dispatch` command, #406) should read
 * this instead of re-deriving the reason themselves:
 *  - 'target-not-found'    — targetEmployeeId does not match anyone on the roster.
 *  - 'target-unqualified'  — the targeted employee specifically lacks requiredSkill,
 *                            even if someone else on the roster holds it.
 *  - 'roster-unqualified'  — no targetEmployeeId was set, and nobody on the whole
 *                            roster holds requiredSkill.
 */
export type DispatchRejectionReason = 'target-not-found' | 'target-unqualified' | 'roster-unqualified';

/**
 * Dispatch a pending action to the game state.
 * Returns { success: false, error: 'unqualified', reason: ... } if no employee
 * on the roster has the required skill — see DispatchRejectionReason for what
 * `reason` distinguishes.
 *
 * When `action.targetEmployeeId` is set, the action can only ever be claimed by
 * that one employee (see tickEmployees' idleMatch in EmployeeDispatchSteps.ts) — a roster-wide
 * "does anyone qualify" check is not sufficient in that case, since a *different*
 * qualified employee existing does nothing for an action only the target can
 * claim. Qualification is checked against the target specifically (#406).
 */
export function dispatchPendingAction(
  state: GameState,
  action: Omit<PendingAction, 'status' | 'holderId' | 'queuedAtTick'>,
  options?: { skipQualificationCheck?: boolean; deferClassification?: boolean },
): { success: boolean; error?: string; reason?: DispatchRejectionReason } {
  const targetId = action.targetEmployeeId;
  const isQualified = (emp: Pick<Employee, 'alive' | 'qualifications'>): boolean =>
    emp.alive && holdsRequiredSkill(emp, action.requiredSkill);

  // skipQualificationCheck (#552): HaulDispatch.ts's syncHaulDispatch needs a
  // haul_debris/fragment_debris action to sit queued silently even when the
  // roster currently has nobody qualified (a fresh site with no hauler/driver
  // yet) — the actual qualification these action types need is enforced at
  // claim time via requiredVehicleRole/findVehicleForClaim instead, not here.
  if (!options?.skipQualificationCheck) {
    if (targetId !== null && targetId !== undefined) {
      const target = state.employees.employees.find(emp => emp.id === targetId);
      if (target === undefined) {
        return { success: false, error: 'unqualified', reason: 'target-not-found' };
      }
      if (!isQualified(target)) {
        return { success: false, error: 'unqualified', reason: 'target-unqualified' };
      }
    } else if (!state.employees.employees.some(isQualified)) {
      return { success: false, error: 'unqualified', reason: 'roster-unqualified' };
    }
  }
  // Full record constructed here — every dispatch starts life queued and
  // unheld (#547); callers no longer supply status/holderId themselves.
  state.pendingActions.push({ ...action, status: 'queued', holderId: null, queuedAtTick: state.tickCount });
  // A `place_building` or `level_ground` ghost carries its real footprint
  // (#556, widened by #1009) so the renderer can draw the full site/area
  // outline instead of a single point — every other action type's ghost is
  // unaffected, footprint stays undefined.
  const footprint = isFootprintAction(action.type)
    ? (action.payload['footprint'] as ReadonlyArray<readonly [number, number]> | undefined)
    : undefined;
  state.ghostPreviews.push({
    id: action.id,
    type: action.type,
    targetX: action.targetX,
    targetZ: action.targetZ,
    targetY: action.targetY,
    claimed: false,
    ...(footprint !== undefined ? { footprint } : {}),
    ...buildingInfoForGhost(state, action),
  });
  state.ghostPreviewsRevision++;
  // Colour the new ghost now, not on the next tick — a paused game never ticks (#1306).
  // deferClassification: a caller dispatching a batch classifies once afterwards.
  if (!options?.deferClassification) classifyNewOrder(state, action.id);
  return { success: true };
}

/**
 * Claim a pending action by id, assigning it to `employeeId`. The action (and
 * its ghost) remain in `state.pendingActions`/`state.ghostPreviews` — only
 * status/holderId (and the ghost's `claimed` flag) change, so the record
 * stays visible while the employee walks to it (#547).
 *
 * Returns null (a no-op guard against double-claiming) when the action does
 * not exist, or its status is not 'queued' — an already-assigned/in_progress
 * action cannot be claimed a second time. Returns the mutated action on
 * success.
 */
export function claimPendingAction(
  state: GameState,
  actionId: number,
  employeeId: number,
): PendingAction | null {
  const action = state.pendingActions.find(a => a.id === actionId);
  if (!action || action.status !== 'queued') return null;

  action.status = 'assigned';
  action.holderId = employeeId;

  const ghost = state.ghostPreviews.find(g => g.id === actionId);
  if (ghost) {
    ghost.claimed = true;
    state.ghostPreviewsRevision++;
  }

  return action;
}

/** What a `place_building` ghost draws as its hologram (#1306); `{}` for every other action. */
function buildingInfoForGhost(
  state: GameState,
  action: Pick<PendingAction, 'type' | 'payload'>,
): Pick<GhostPreview, 'building'> {
  if (action.type !== 'place_building') return {};
  const order = state.plannedBuildings.find(pb => pb.id === action.payload['buildingOrderId']);
  return order === undefined ? {} : { building: { type: order.type, tier: order.tier, x: order.x, z: order.z } };
}

/** Fill in `building` on `place_building` ghosts restored from a save that predates it (#1306). */
export function backfillGhostBuildings(state: GameState): void {
  const actionById = new Map(state.pendingActions.map(a => [a.id, a]));
  for (const ghost of state.ghostPreviews) {
    const action = actionById.get(ghost.id);
    if (ghost.building !== undefined || action === undefined) continue;
    const info = buildingInfoForGhost(state, action);
    if (info.building !== undefined) {
      ghost.building = info.building;
      state.ghostPreviewsRevision++;
    }
  }
}
