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
import { AGENT_WALK_SPEED, ACTION_SELECTION_MAX_PATH_ATTEMPTS, BASE_TASK_DURATION_TICKS, NEED_REST_DURATIONS, ORE_HAUL_PRIORITY_BONUS_TICKS, ACTION_STARVATION_TICK_THRESHOLD } from '../config/balance.js';
import { computeRampSegmentDurationTicks } from '../mining/Ramp.js';
import type { VehicleTier } from '../entities/Vehicle.js';
import { haulActionCarriesOre } from '../economy/HaulDispatch.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import { isDestinationOccupied } from './EntityMovementTick.js';
import { findFreeVehicleForRole } from './VehicleReservation.js';
import { isEvacuationHoldActive } from './Evacuation.js';

/** Every configured NeedKey — used to validate an untyped payload value against the catalog rather than a hardcoded literal (#1062 genericity). */
const NEED_KEYS = Object.keys(NEED_REST_DURATIONS) as NeedKey[];

/**
 * Determine which need gauge a 'rest' PendingAction's payload is restoring,
 * or null if the payload doesn't identify one — this is the case for the
 * Bunkhouse Tier 2+ shift-cycle rest created by forceShiftRestIfNeeded, which
 * processShiftCycle/completeRestTick already own end-to-end and never routes
 * through this cost-based selection path (it self-claims at creation).
 *
 * Validated against NEED_KEYS (derived from NEED_REST_DURATIONS' own keys)
 * rather than a hardcoded 'fatigue' literal, so a second NeedKey added to the
 * config maps is recognized here with no code change (#1062 genericity).
 */
export function resolveRestNeedKey(payload: Record<string, unknown>): NeedKey | null {
  const candidate = payload['needKey'];
  return typeof candidate === 'string' && (NEED_KEYS as string[]).includes(candidate) ? candidate as NeedKey : null;
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

  if (action.type === 'dig_ramp_segment' || action.type === 'level_ground') {
    // Both action types carve a voxel `cells` list into the grid at the same
    // rate — one shared duration formula (computeRampSegmentDurationTicks),
    // caller-neutral despite its ramp-flavoured name (#1009 review finding 1).
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
 * The coordinate `employee` must actually walk to on foot to work `action` —
 * the action's own target for an ordinary on-foot action, but for a
 * vehicle-gated one (#954 follow-up, economy-full-loop regression) the
 * RESERVED VEHICLE's own current position instead: promoteVehicleGatedAction/
 * requestBoardVehicle (VehicleReservation.ts) send the employee walking to
 * board the vehicle first, never straight to the action's own cargo target —
 * only the vehicle itself drives there afterward (moveVehicle). Using
 * action.targetX/targetZ here for a vehicle-gated action validated
 * reachability against a coordinate the employee's own foot-walk never goes
 * near, which cuts both ways: a claim could pass with a cargo target that
 * happens to read as "occupied" (so avoidVehicles' exemption falls out in its
 * favor) while the real walk to a perfectly reachable vehicle never needed
 * that exemption at all, or — the regression this fixes — a claim could pass
 * purely because the cargo target's own occupancy happened to disable
 * avoidVehicles for that resolution, while the real walk (to the reserved
 * vehicle's unoccupied, and therefore avoidVehicles-enabled, cell) finds the
 * employee's current position boxed in by fragment occupancy on every
 * neighbour cell — genuinely unreachable, but reported claimable anyway.
 * Direct-traced via economy-full-loop.json: a driver mid-shift on a
 * rock_fragmenter reserves a debris_hauler haul action ahead of time
 * (reserveOnePoolActionAhead); by the time that reservation is promoted, the
 * rubble their own rock-breaking work just produced surrounds their current
 * cell on all 8 sides, and the debris_hauler's own spawn cell was never
 * marked vehicleOccupied (only a NavGrid rebuild or an actual drive seeds
 * that flag — a freshly bought, never-yet-driven vehicle has neither) — so
 * `isDestinationOccupied` on the vehicle's real position reads false,
 * avoidVehicles stays enabled for that walk, and a boxed-in employee has no
 * legal first step at all, regardless of distance. Falls back to the
 * action's own target when no vehicle is reserved yet and none is currently
 * free (defensive — findVehicleForClaim's own isClaimable gate normally
 * prevents resolveActionCost from ever being asked about such a candidate),
 * and when `employee` already holds the reserved vehicle's driverId (the
 * continuity case — already boarded, no further foot-walk needed at all).
 */
function resolveVehicleGatedWalkTarget(state: GameState, employee: Employee, action: PendingAction): { x: number; z: number } {
  if (action.requiredVehicleRole === null) {
    return { x: action.targetX, z: action.targetZ };
  }

  const reserved = state.vehicles.vehicles.find(v => v.reservedForActionId === action.id);
  const vehicle = reserved ?? findFreeVehicleForRole(state, action.requiredVehicleRole, employee);

  if (vehicle === null || vehicle.driverId === employee.id) {
    return { x: action.targetX, z: action.targetZ };
  }

  return { x: vehicle.x, z: vehicle.z };
}

/**
 * Real findPath-based cost for `employee` performing `action`, or `null` if
 * the target is unreachable on the current NavGrid.
 *
 * With no NavGrid built yet (state.navGrid === null), mirrors
 * tickEmployeeMovement's own fallback (EntityMovementTick.ts): the target is
 * treated as directly reachable via a straight line, so this never returns
 * null purely for lack of a NavGrid.
 *
 * The walk target itself is resolveVehicleGatedWalkTarget's own concern (see
 * its doc comment) — a vehicle-gated action's real foot-walk goes to the
 * reserved vehicle, not the action's cargo target.
 *
 * avoidVehicles mirrors tickEmployeeMovement's own rule for the exact same
 * walk (#954 follow-up fix): an employee's foot travel avoids vehicle/
 * fragment-occupied cells, except when the destination itself is occupied
 * (isDestinationOccupied — boarding a vehicle, charging a hole a drill_rig
 * still sits on). Before this fix the claim-time reachability check here
 * always passed avoidVehicles: false, so it could report an action
 * "reachable" (and cheap) for an employee whose real walk — which DOES avoid
 * occupied cells — can never actually get there, e.g. an employee standing
 * inside a dense post-blast fragment field with zero passable neighbour
 * cells. selectBestActionForEmployee/claimOnePoolCandidate then let that
 * employee claim the action anyway; EntityMovementTick.ts's own
 * MOVE_STUCK_ABANDON_TICKS mechanism (#938) would release it back to the pool
 * ~30 ticks later, but with employees dispatched in ascending-id order and no
 * other employee ever getting a look-in before this one re-claims the SAME
 * unreachable action via the SAME false-positive check, the whole cycle
 * repeats forever — a livelock, not a slow convergence (confirmed live:
 * tutorial-playthrough.json's own freight_warehouse order, with the one
 * employee standing on it after a blast permanently boxed in by fragment
 * occupancy on every one of its 8 neighbour cells, monopolized the claim for
 * 400+ ticks while a second, unblocked, idle employee stood by, qualified and
 * reachable, the whole time). Matching the real walk rule here means an
 * employee this action can never reach now correctly resolves to `null`
 * (unclaimable), so selectBestActionForEmployee/claimOnePoolCandidate leave
 * it queued for a genuinely reachable employee instead.
 */
export function resolveActionCost(state: GameState, employee: Employee, action: PendingAction): { totalTicks: number } | null {
  const workTicks = computeActionWorkTicks(state, employee, action);
  const walkTarget = resolveVehicleGatedWalkTarget(state, employee, action);

  if (state.navGrid === null) {
    return { totalTicks: cellsToTravelTicks(octileHeuristic(employee.x, employee.z, walkTarget.x, walkTarget.z)) + workTicks };
  }

  const path = findPath(state.navGrid, {
    agentId: employee.id,
    fromX: employee.x,
    fromZ: employee.z,
    toX: walkTarget.x,
    toZ: walkTarget.z,
    avoidVehicles: !isDestinationOccupied(state, walkTarget.x, walkTarget.z),
  });

  if (!path.found) return null;

  const travelTicks = cellsToTravelTicks(path.totalCost);
  return { totalTicks: travelTicks + workTicks };
}

/**
 * True when `action` is an on-foot (requiredVehicleRole === null) action,
 * `employee` cannot currently reach it from their own position
 * (resolveActionCost returns null), and a different employee exists — alive,
 * activeActionId === null, restTicksRemaining === null, and holding
 * requiredSkill if one is set — who could attempt it instead.
 *
 * Assumes/requires the caller only passes an on-foot action currently held
 * by `employee` (e.g. sourced from `employee.taskQueue`); this function does
 * not itself verify taskQueue membership.
 */
export function canReleaseStrandedOnFootAction(
  state: GameState,
  employee: Employee,
  action: PendingAction,
): boolean {
  if (action.requiredVehicleRole !== null) return false;
  if (state.navGrid === null) return false;
  if (resolveActionCost(state, employee, action) !== null) return false;

  return state.employees.employees.some(other =>
    other.id !== employee.id &&
    other.alive &&
    other.activeActionId === null &&
    other.restTicksRemaining === null &&
    (action.requiredSkill === null || other.qualifications.some(q => q.category === action.requiredSkill)),
  );
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

/**
 * The three-clause "is this queued action open to `employee`" check shared
 * by `findStarvedActionForEmployee` below and VehicleContinuity.ts's
 * `tryContinueVehicleGatedAction` (its `poolFollowUps` filter): still
 * `queued`, untargeted or targeted at `employee`, and `employee` holds
 * `requiredSkill` when one is set. Each caller layers its own extra clauses
 * on top (vehicle role, evacuation hold, claimability, staleness threshold)
 * — this helper knows about none of them, so a caller's clause can change
 * without touching the other's.
 */
export function isQueuedActionAvailableToEmployee(employee: Employee, action: PendingAction): boolean {
  return action.status === 'queued' &&
    (action.targetEmployeeId === null || action.targetEmployeeId === employee.id) &&
    (action.requiredSkill === null || employee.qualifications.some(q => q.category === action.requiredSkill));
}

/**
 * Finds a queued, unclaimed, `requiredVehicleRole === null` action that has
 * been waiting at least `ACTION_STARVATION_TICK_THRESHOLD` ticks and is
 * claimable by `employee` — called from VehicleContinuity.ts's
 * `completeVehicleGatedActionIfApplicable`, before it would otherwise invoke
 * `tryContinueVehicleGatedAction`, so a long-starved on-foot action can win
 * dispatch over the same-role vehicle continuity fast path (#1000).
 *
 * Excludes an action under an active evacuation hold (`isEvacuationHoldActive`,
 * Evacuation.ts) exactly like the other two claim-eligibility filters
 * (`claimOnePoolCandidate`, `claimActionsTargetedAtEmployee` in
 * EmployeeDispatchSteps.ts) — `evacuateZone` stamps the hold on every queued
 * action inside an evacuated zone regardless of `requiredVehicleRole`, so an
 * on-foot action can be held exactly as often as a vehicle-gated one, and
 * force-assigning a held one here would send `employee` back into a
 * still-dangerous zone.
 */
export function findStarvedActionForEmployee(state: GameState, employee: Employee): SelectedAction | null {
  const candidates = state.pendingActions.filter(a =>
    isQueuedActionAvailableToEmployee(employee, a) &&
    a.requiredVehicleRole === null &&
    !isEvacuationHoldActive(state, a) &&
    state.tickCount - a.queuedAtTick >= ACTION_STARVATION_TICK_THRESHOLD);

  return selectBestActionForEmployee(state, employee, candidates);
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
