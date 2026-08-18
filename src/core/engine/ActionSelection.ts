// BlastSimulator2026 — Cost-based per-employee action selection (#549)
// Ranks queued PendingActions by (travel + work) cost so each idle qualified
// employee picks the cheapest reachable action instead of first-come-first-
// served. Zero imports from GameLoop.ts — avoids a dependency cycle back into
// the tick orchestrator that calls these functions.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee, NeedKey } from '../entities/Employee.js';
import { getLivingEmployees } from '../entities/Employee.js';
import { octileHeuristic, findPath } from '../nav/Pathfinding.js';
import { computeTaskDuration } from '../entities/EmployeeTaskDuration.js';
import { getNeedMultiplier } from '../entities/EmployeeNeeds.js';
import { getLivingQuartersWellbeingMultiplier } from '../entities/BuildingWellbeing.js';
import { AGENT_WALK_SPEED, ACTION_SELECTION_MAX_PATH_ATTEMPTS, BASE_TASK_DURATION_TICKS, NEED_REST_DURATIONS } from '../config/balance.js';

/**
 * Determine which need gauge a 'rest' PendingAction's payload is restoring,
 * or null if the payload doesn't identify one — this is the case for the
 * Bunkhouse Tier 2+ shift-cycle rest created by forceShiftRestIfNeeded, which
 * processShiftCycle/completeRestTick already own end-to-end and never routes
 * through this cost-based selection path (it self-claims at creation).
 */
export function resolveRestNeedKey(payload: Record<string, unknown>): NeedKey | null {
  const candidate = payload['needKey'];
  return candidate === 'hunger' || candidate === 'fatigue' || candidate === 'breakNeed' ? candidate : null;
}

/**
 * Work-duration ticks for `employee` performing `action` — the same
 * computation GameLoop.ts's tickEmployees used to do inline at claim time.
 * Single source of truth for both the cost estimate/resolution below and the
 * claim-time seeding of pendingTaskDuration/pendingRestDuration in GameLoop.ts.
 *
 * A survey's own durationTicks (SURVEY_DURATION_TICKS[method], set by
 * runSurvey) and a rest action's own restDuration override the generic
 * proficiency-scaled duration — both already appear directly in the action's
 * payload rather than being derived here.
 */
export function computeActionWorkTicks(state: GameState, employee: Employee, action: PendingAction): number {
  if (action.type === 'rest') {
    if (typeof action.payload['restDuration'] === 'number') {
      return action.payload['restDuration'] as number;
    }
    const needKey = resolveRestNeedKey(action.payload);
    return needKey !== null ? NEED_REST_DURATIONS[needKey] : BASE_TASK_DURATION_TICKS;
  }

  if (typeof action.payload['durationTicks'] === 'number') {
    return action.payload['durationTicks'] as number;
  }

  const qual = action.requiredSkill !== null
    ? employee.qualifications.find(q => q.category === action.requiredSkill)
    : undefined;
  const level = qual?.proficiencyLevel ?? 1;
  const needMult = getNeedMultiplier(employee);
  const lqMult = getLivingQuartersWellbeingMultiplier(state.buildings, getLivingEmployees(state.employees.employees).length);
  return computeTaskDuration(BASE_TASK_DURATION_TICKS, level, needMult, lqMult, 1);
}

/**
 * Seeds the work-timer-on-arrival fields (pendingTaskDuration, activeTaskSkill,
 * pendingActionType, pendingActionPayload) that ArrivalGate.tickArrivalGate
 * promotes into taskTicksRemaining once the entity physically reaches the
 * action's target — the employee themself for an on-foot action, or (#550)
 * their reserved vehicle for a vehicle-gated one. Shared by GameLoop.ts's
 * promoteActionToActive (on-foot claim, unchanged behavior) and
 * ArrivalGate.ts's vehicle-arrival transition, so both start work identically
 * instead of duplicating the same four-field assignment in two places.
 */
export function seedTaskTimerFields(state: GameState, employee: Employee, action: PendingAction): void {
  employee.pendingTaskDuration = computeActionWorkTicks(state, employee, action);
  employee.activeTaskSkill = action.requiredSkill;
  employee.pendingActionType = action.type;
  employee.pendingActionPayload = action.payload;
}

/**
 * Straight-line (octile-heuristic) travel ticks for `employee` to reach
 * `action`'s target — see `octileHeuristic` in `Pathfinding.ts`. Shared by
 * `estimateActionCost` (always uses this direct-line estimate) and
 * `resolveActionCost`'s null-navGrid branch, which mirrors
 * `tickEmployeeMovement`'s own fallback (EntityMovementTick.ts) when no
 * NavGrid has been built yet.
 */
function estimateTravelTicks(employee: Employee, action: PendingAction): number {
  return octileHeuristic(employee.x, employee.z, action.targetX, action.targetZ) / AGENT_WALK_SPEED;
}

/**
 * Cheap admissible cost estimate for `employee` performing `action`: octile-
 * heuristic travel ticks (`estimateTravelTicks`) plus work ticks (via
 * `computeActionWorkTicks`). No real pathfinding — used to rank candidates
 * before spending a real `findPath` call on only the most promising ones.
 * The octile distance is itself the direct-line estimate
 * `tickEmployeeMovement` (EntityMovementTick.ts) falls back to when
 * `state.navGrid` is null, so no separate null-navGrid branch is needed here.
 */
export function estimateActionCost(state: GameState, employee: Employee, action: PendingAction): number {
  return estimateTravelTicks(employee, action) + computeActionWorkTicks(state, employee, action);
}

/**
 * Real findPath-based cost for `employee` performing `action`, or `null` if
 * the target is unreachable on the current NavGrid.
 *
 * With no NavGrid built yet (state.navGrid === null), mirrors
 * tickEmployeeMovement's own fallback (EntityMovementTick.ts): the target is
 * treated as directly reachable via a straight line, so this never returns
 * null purely for lack of a NavGrid.
 */
export function resolveActionCost(state: GameState, employee: Employee, action: PendingAction): { totalTicks: number } | null {
  const workTicks = computeActionWorkTicks(state, employee, action);

  if (state.navGrid === null) {
    return { totalTicks: estimateTravelTicks(employee, action) + workTicks };
  }

  const path = findPath(state.navGrid, {
    agentId: employee.id,
    fromX: employee.x,
    fromZ: employee.z,
    toX: action.targetX,
    toZ: action.targetZ,
    avoidVehicles: false,
  });

  if (!path.found) return null;

  const travelTicks = path.totalCost / AGENT_WALK_SPEED;
  return { totalTicks: travelTicks + workTicks };
}

/** A candidate action chosen for an employee, with its resolved real cost. */
export interface SelectedAction {
  action: PendingAction;
  totalTicks: number;
}

/**
 * Picks the best action for `employee` out of `candidates`. Ranks by
 * `estimateActionCost`, ties broken by lowest `action.id`, then resolves the
 * real cost (via `resolveActionCost`) only for the top candidates up to
 * `ACTION_SELECTION_MAX_PATH_ATTEMPTS`, returning the first reachable one for
 * which the optional `isClaimable` predicate also passes.
 *
 * `isClaimable` (default: always true) lets a caller apply a claim-time gate
 * — e.g. GameLoop.ts's vehicle-availability check (`findVehicleForClaim`) —
 * without this module importing that gate itself (would cycle back into the
 * tick orchestrator, see header). Checked before the (pricier) real-cost
 * resolution so a candidate that can never be claimed right now doesn't
 * spend a `findPath` call. Bounded by the same
 * `ACTION_SELECTION_MAX_PATH_ATTEMPTS` budget as reachability — a nearest
 * candidate that keeps failing this gate (#552: e.g. an oversized fragment
 * with no rock_fragmenter driver free) is skipped in favor of the next-
 * cheapest one the employee can actually perform this tick, instead of
 * leaving them idle, but only within that bounded top-N window rather than
 * scanning the whole candidate list.
 *
 * Returns `null` when `candidates` is empty or none of the top-ranked ones
 * are both reachable and claimable.
 */
/**
 * Claim-time gate for a `dig_ramp_segment` PendingAction — mirrors the shape
 * of GameLoop.ts's vehicle-availability `isClaimable` predicate passed into
 * `selectBestActionForEmployee` (see its doc above), but is not yet wired
 * into that call site.
 * TODO: implement.
 */
export function isRampSegmentClaimable(_state: GameState, _action: PendingAction): boolean {
  return true;
}

export function selectBestActionForEmployee(
  state: GameState,
  employee: Employee,
  candidates: PendingAction[],
  isClaimable: (action: PendingAction) => boolean = () => true,
): SelectedAction | null {
  if (candidates.length === 0) return null;

  const ranked = [...candidates].sort((a, b) => {
    const costDiff = estimateActionCost(state, employee, a) - estimateActionCost(state, employee, b);
    return costDiff !== 0 ? costDiff : a.id - b.id;
  });

  const attempts = Math.min(ranked.length, ACTION_SELECTION_MAX_PATH_ATTEMPTS);
  for (let i = 0; i < attempts; i++) {
    const candidate = ranked[i]!;
    if (!isClaimable(candidate)) continue;
    const resolved = resolveActionCost(state, employee, candidate);
    if (resolved !== null) {
      return { action: candidate, totalTicks: resolved.totalTicks };
    }
  }

  return null;
}
