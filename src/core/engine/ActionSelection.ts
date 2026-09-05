// BlastSimulator2026 — Cost-based per-employee action selection (#549)
// Ranks queued PendingActions by (travel + work) cost so each idle qualified
// employee picks the cheapest reachable action instead of first-come-first-
// served. Zero imports from GameLoop.ts — avoids a dependency cycle back into
// the tick orchestrator that calls these functions.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee, NeedKey } from '../entities/Employee.js';
import { getLivingEmployees } from '../entities/Employee.js';
import { octileHeuristic, findPath } from '../nav/Pathfinding.js';
import { NavGrid } from '../nav/NavGrid.js';
import { computeTaskDuration } from '../entities/EmployeeTaskDuration.js';
import { getNeedMultiplier } from '../entities/EmployeeNeeds.js';
import { getLivingQuartersWellbeingMultiplier } from '../entities/BuildingWellbeing.js';
import { AGENT_WALK_SPEED, ACTION_SELECTION_MAX_PATH_ATTEMPTS, BASE_TASK_DURATION_TICKS, NEED_REST_DURATIONS, ORE_HAUL_PRIORITY_BONUS_TICKS } from '../config/balance.js';
import { computeRampSegmentDurationTicks } from '../mining/Ramp.js';
import type { VehicleTier } from '../entities/Vehicle.js';
import { haulActionCarriesOre } from '../economy/HaulDispatch.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';

/**
 * Determine which need gauge a 'rest' PendingAction's payload is restoring,
 * or null if the payload doesn't identify one — this is the case for the
 * Bunkhouse Tier 2+ shift-cycle rest created by forceShiftRestIfNeeded, which
 * processShiftCycle/completeRestTick already own end-to-end and never routes
 * through this cost-based selection path (it self-claims at creation).
 */
export function resolveRestNeedKey(payload: Record<string, unknown>): NeedKey | null {
  const candidate = payload['needKey'];
  return candidate === 'fatigue' ? candidate : null;
}

/**
 * Proficiency level (for `action.requiredSkill`, default 1) plus the need and
 * living-quarters wellbeing multipliers for `employee` — the three inputs
 * `computeActionWorkTicks`'s `dig_ramp_segment` branch and generic fallback
 * both feed into their respective duration formulas. Single source of truth
 * for that lookup so the two branches can't drift.
 */
function resolveEmployeeProductivityInputs(
  state: GameState,
  employee: Employee,
  action: PendingAction,
): { level: 1 | 2 | 3 | 4 | 5; needMult: number; lqMult: number } {
  const qual = action.requiredSkill !== null
    ? employee.qualifications.find(q => q.category === action.requiredSkill)
    : undefined;
  const level = qual?.proficiencyLevel ?? 1;
  const needMult = getNeedMultiplier(employee);
  const lqMult = getLivingQuartersWellbeingMultiplier(state.buildings, getLivingEmployees(state.employees.employees).length);
  return { level, needMult, lqMult };
}

/**
 * Work-duration ticks for `employee` performing `action` — the same
 * computation EmployeeDispatch.ts's tickEmployees used to do inline at claim time.
 * Single source of truth for both the cost estimate/resolution below and the
 * claim-time seeding of pendingTaskDuration/pendingRestDuration in EmployeeDispatchSteps.ts.
 *
 * A survey's own durationTicks (SURVEY_DURATION_TICKS[method], set by
 * runSurvey) and a rest action's own restDuration override the generic
 * proficiency-scaled duration — both already appear directly in the action's
 * payload rather than being derived here.
 *
 * `grid`, when provided, lets the `dig_ramp_segment` branch read the live
 * voxel count instead of the stale one captured in the action's payload at
 * queue time (#924) — omitted (ranking/ETA call sites) keeps today's
 * stale-count behavior unchanged.
 */
export function computeActionWorkTicks(state: GameState, employee: Employee, action: PendingAction, grid?: VoxelGrid): number {
  if (action.type === 'rest') {
    if (typeof action.payload['restDuration'] === 'number') {
      return action.payload['restDuration'] as number;
    }
    const needKey = resolveRestNeedKey(action.payload);
    return needKey !== null ? NEED_REST_DURATIONS[needKey] : BASE_TASK_DURATION_TICKS;
  }

  if (action.type === 'dig_ramp_segment') {
    const cells = (action.payload['cells'] as { x: number; y: number; z: number }[] | undefined) ?? [];
    const voxelCount = grid !== undefined
      ? cells.filter(c => grid.densityAt(c.x, c.y, c.z) > 0).length
      : cells.length;
    const vehicle = state.vehicles.vehicles.find(v => v.reservedForActionId === action.id);
    const { level, needMult, lqMult } = resolveEmployeeProductivityInputs(state, employee, action);
    return computeRampSegmentDurationTicks(voxelCount, (vehicle?.tier ?? 1) as VehicleTier, level, needMult, lqMult);
  }

  if (typeof action.payload['durationTicks'] === 'number') {
    return action.payload['durationTicks'] as number;
  }

  const { level, needMult, lqMult } = resolveEmployeeProductivityInputs(state, employee, action);
  return computeTaskDuration(BASE_TASK_DURATION_TICKS, level, needMult, lqMult, 1);
}

/**
 * Seeds the work-timer-on-arrival fields (pendingTaskDuration, activeTaskSkill,
 * pendingActionType, pendingActionPayload) that ArrivalGate.tickArrivalGate
 * promotes into taskTicksRemaining once the entity physically reaches the
 * action's target — the employee themself for an on-foot action, or (#550)
 * their reserved vehicle for a vehicle-gated one. Shared by EmployeeDispatchSteps.ts's
 * promoteActionToActive (on-foot claim, unchanged behavior) and
 * ArrivalGate.ts's vehicle-arrival transition, so both start work identically
 * instead of duplicating the same four-field assignment in two places.
 *
 * `grid` is threaded straight through to `computeActionWorkTicks` (#924).
 */
export function seedTaskTimerFields(state: GameState, employee: Employee, action: PendingAction, grid?: VoxelGrid): void {
  employee.pendingTaskDuration = computeActionWorkTicks(state, employee, action, grid);
  employee.activeTaskSkill = action.requiredSkill;
  employee.pendingActionType = action.type;
  employee.pendingActionPayload = action.payload;
}

/**
 * Converts a grid-cell distance (from either the octile-heuristic estimate
 * or a real findPath's totalCost) into ticks, at AGENT_WALK_SPEED cells per
 * tick. Single source of truth for both estimateTravelTicks (heuristic) and
 * resolveActionCost (pathfinding) (#614).
 */
function cellsToTravelTicks(cells: number): number {
  return cells / AGENT_WALK_SPEED;
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
  return cellsToTravelTicks(octileHeuristic(employee.x, employee.z, action.targetX, action.targetZ));
}

/**
 * Cheap admissible cost estimate for `employee` performing `action`: octile-
 * heuristic travel ticks (`estimateTravelTicks`) plus work ticks (via
 * `computeActionWorkTicks`). No real pathfinding — used to rank candidates
 * before spending a real `findPath` call on only the most promising ones.
 * The octile distance is itself the direct-line estimate
 * `tickEmployeeMovement` (EntityMovementTick.ts) falls back to when
 * `state.navGrid` is null, so no separate null-navGrid branch is needed here.
 *
 * Ore-bearing haul_debris/fragment_debris candidates (`haulActionCarriesOre`)
 * get ORE_HAUL_PRIORITY_BONUS_TICKS subtracted here so they outrank a
 * same-role plain-spoil candidate at realistic intra-site distances (#671) —
 * ore fragments would otherwise starve behind whichever fragment is nearest,
 * filling a small warehouse with rock before any ore is ever hauled in. This
 * is ranking-only: resolveActionCost's real totalTicks (used for
 * ETA/duration seeding) never applies the bonus. Clamped at 0 since this
 * value only ever feeds a sort comparison.
 */
export function estimateActionCost(state: GameState, employee: Employee, action: PendingAction): number {
  const rawCost = estimateTravelTicks(employee, action) + computeActionWorkTicks(state, employee, action);
  const bonus = haulActionCarriesOre(state, action) ? ORE_HAUL_PRIORITY_BONUS_TICKS : 0;
  return Math.max(0, rawCost - bonus);
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

  const travelTicks = cellsToTravelTicks(path.totalCost);
  return { totalTicks: travelTicks + workTicks };
}

/** A candidate action chosen for an employee, with its resolved real cost. */
export interface SelectedAction {
  action: PendingAction;
  totalTicks: number;
}

/**
 * Picks the best action for `employee` out of `candidates`. First filters out
 * every candidate the optional `isClaimable` predicate rejects, then ranks
 * the remainder by `estimateActionCost` (ties broken by lowest `action.id`),
 * then resolves the real cost (via `resolveActionCost`) for the top ranked
 * candidates up to `ACTION_SELECTION_MAX_PATH_ATTEMPTS`, returning the first
 * reachable one.
 *
 * `isClaimable` (default: always true) lets a caller apply a claim-time gate
 * — e.g. EmployeeDispatchSteps.ts's vehicle-availability check (`findVehicleForClaim`) —
 * without this module importing that gate itself (would cycle back into the
 * tick orchestrator, see header). Applied as a pre-filter over the whole
 * candidate pool, before ranking and before the bounded attempt loop, so a
 * backlog of candidates that categorically fail it (#611: e.g. haul actions
 * requiring a vehicle-role licence the employee doesn't hold) can never burn
 * through the `ACTION_SELECTION_MAX_PATH_ATTEMPTS` budget without a single
 * real `findPath` resolution — every attempt in the bounded loop is now
 * spent on `resolveActionCost` only, never on discovering unclaimability.
 *
 * Returns `null` when `candidates` is empty, when every candidate fails
 * `isClaimable`, or when none of the top-ranked claimable candidates are
 * reachable.
 */
/**
 * Claim-time gate for a `dig_ramp_segment` PendingAction — mirrors the shape
 * of EmployeeDispatchSteps.ts's vehicle-availability `isClaimable` predicate passed into
 * `selectBestActionForEmployee` (see its doc above). Enforces top-down
 * (bench-by-bench) excavation order: each segment is one horizontal layer
 * across the whole ramp footprint (#925), `index` 0 = topmost. Segment 0 is
 * always claimable, and any later segment only once its immediate
 * predecessor layer (`index - 1`, the layer directly above it) in the same
 * `PlannedRamp` is `done` — a layer can't be started until the layer above
 * it is fully cleared. Any non-`dig_ramp_segment` action, or a segment whose
 * owning `PlannedRamp` can't be found (defensive — should never happen), is
 * claimable — fail-open rather than stranding work nobody can ever pick up.
 */
export function isRampSegmentClaimable(state: GameState, action: PendingAction): boolean {
  if (action.type !== 'dig_ramp_segment') return true;

  const rampId = action.payload['rampId'];
  const segmentIndex = action.payload['segmentIndex'];
  if (typeof rampId !== 'number' || typeof segmentIndex !== 'number') return true;

  const ramp = state.plannedRamps.find(r => r.id === rampId);
  if (!ramp) return true;

  if (segmentIndex === 0) return true;

  const previous = ramp.segments.find(s => s.index === segmentIndex - 1);
  return previous?.done === true;
}

export function selectBestActionForEmployee(
  state: GameState,
  employee: Employee,
  candidates: PendingAction[],
  isClaimable: (action: PendingAction) => boolean = () => true,
): SelectedAction | null {
  if (candidates.length === 0) return null;

  const claimable = candidates.filter(isClaimable);
  if (claimable.length === 0) return null;

  const ranked = [...claimable].sort((a, b) => {
    const costDiff = estimateActionCost(state, employee, a) - estimateActionCost(state, employee, b);
    return costDiff !== 0 ? costDiff : a.id - b.id;
  });

  // Cheap, exact pre-filter (#953): a candidate outside the employee's own
  // climb-aware reachable set (e.g. inside a fresh blast crater's walled-off
  // interior) can never be reached by any real findPath, so it's skipped
  // below without spending one of the bounded real-pathfind attempts — frees
  // the budget for a farther candidate that might actually resolve. One
  // flood fill for the whole call, reused as an O(1) check per candidate.
  const climbReachable = state.navGrid !== null
    ? NavGrid.computeClimbReachableSet(state.navGrid, employee.x, employee.z)
    : null;

  let attemptsSpent = 0;
  for (let i = 0; i < ranked.length && attemptsSpent < ACTION_SELECTION_MAX_PATH_ATTEMPTS; i++) {
    const candidate = ranked[i]!;

    if (climbReachable !== null && state.navGrid !== null) {
      const cx = state.navGrid.clampX(candidate.targetX);
      const cz = state.navGrid.clampZ(candidate.targetZ);
      if (!climbReachable.has(cx, cz)) continue;
    }

    attemptsSpent++;
    const resolved = resolveActionCost(state, employee, candidate);
    if (resolved !== null) {
      return { action: candidate, totalTicks: resolved.totalTicks };
    }
  }

  return null;
}
