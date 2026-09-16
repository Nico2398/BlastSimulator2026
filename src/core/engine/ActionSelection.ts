// BlastSimulator2026 — Cost-based per-employee action selection (#549)
// Ranks queued PendingActions by (travel + work) cost so each idle qualified
// employee picks the cheapest reachable action instead of first-come-first-
// served. Zero imports from GameLoop.ts — avoids a dependency cycle back into
// the tick orchestrator that calls these functions.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee, NeedKey } from '../entities/Employee.js';
import { getLivingEmployees } from '../entities/Employee.js';
import { NavGrid } from '../nav/NavGrid.js';
import { computeTaskDuration } from '../entities/EmployeeTaskDuration.js';
import { getNeedMultiplier } from '../entities/EmployeeNeeds.js';
import { getLivingQuartersWellbeingMultiplier } from '../entities/BuildingWellbeing.js';
import { ACTION_SELECTION_MAX_PATH_ATTEMPTS, BASE_TASK_DURATION_TICKS, NEED_REST_DURATIONS, ORE_HAUL_PRIORITY_BONUS_TICKS, ACTION_STARVATION_TICK_THRESHOLD } from '../config/balance.js';
import { computeRampSegmentDurationTicks } from '../mining/Ramp.js';
import type { VehicleTier } from '../entities/Vehicle.js';
import { createFragmentLookup, haulActionCarriesOre, type FragmentLookup } from '../economy/HaulDispatch.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
// #1090: planItinerary (PlanItinerary.ts) itself imports computeActionWorkTicks
// and cellsToTravelTicks from this module — a two-way cycle, safe because
// every import on both sides is a function called only from inside other
// function bodies, never evaluated at module-load time (same reasoning as
// the documented VehicleReservation.ts <-> MoveTo.ts/PlanItinerary.ts cycle).
import { planItinerary } from './PlanItinerary.js';
import { isLicensedForRole } from './VehicleReservation.js';
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
 * or a real findExactPath's totalCost) into ticks, at `speed` cells per tick.
 * Single source of truth for both estimateTravelTicks (heuristic) and
 * resolveActionCost (pathfinding) (#614), and for planItinerary's foot and
 * drive legs (PlanItinerary.ts, #1088), which pass AGENT_WALK_SPEED and a
 * vehicle's own speed respectively.
 */
export function cellsToTravelTicks(cells: number, speed: number): number {
  return cells / speed;
}

/**
 * Cheap admissible cost estimate for `employee` performing `action`: the
 * itinerary `planItinerary` would build at `'estimate'` fidelity (octile
 * heuristic, no real pathfinding) for the goal `{ kind: 'work', actionId:
 * action.id }` — its `estTotalTicks` already sums every leg (walk-to-vehicle,
 * drive, work) `planItinerary` would plan, so a vehicle-gated action's cost
 * reflects the whole trip rather than just the walk to board (#1090). `null`
 * (goal unresolvable — the action vanished between being listed as a
 * candidate and being costed here) costs `Infinity`, same as an unreachable
 * target.
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
export function estimateActionCost(
  state: GameState,
  employee: Employee,
  action: PendingAction,
  fragmentOf?: FragmentLookup,
): number {
  const itinerary = planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'estimate', { action });
  const rawCost = itinerary !== null ? itinerary.estTotalTicks : Infinity;
  const bonus = haulActionCarriesOre(state, action, fragmentOf) ? ORE_HAUL_PRIORITY_BONUS_TICKS : 0;
  return Math.max(0, rawCost - bonus);
}

/**
 * Real, `planItinerary`-at-`'exact'`-fidelity cost for `employee` performing
 * `action` (#1090) — the itinerary's own `estTotalTicks`, which already sums
 * every leg (walk-to-vehicle at walking speed, drive at vehicle speed, work)
 * a vehicle-gated action needs, not just the walk to board. `null` when
 * `planItinerary` can't resolve a route — an unreachable vehicle, an
 * unreachable target, or (`avoidVehicles`, threaded through by
 * `PlanItinerary.ts`'s own `estimateLegDistance`) an employee genuinely boxed
 * in by vehicle occupancy on every neighbour cell of an unoccupied
 * destination — same "stays queued, retries next tick" contract as before:
 * never throws.
 */
export function resolveActionCost(state: GameState, employee: Employee, action: PendingAction): { totalTicks: number } | null {
  const itinerary = planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'exact', { action });
  return itinerary !== null ? { totalTicks: itinerary.estTotalTicks } : null;
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

/**
 * True when a vehicle-gated `action` still sitting in `employee`'s own
 * taskQueue (reserved ahead but never promoted) is genuinely stranded on
 * them — `employee` cannot currently reach the reserved vehicle at all
 * (`resolveActionCost` returns null, exactly like `canReleaseStrandedOnFootAction`'s
 * own on-foot reachability check above) — and a different, idle, licensed
 * employee exists who could pick it up instead. Requires the reserved
 * vehicle to still have no driver: a boarded one is mid-drive/mid-work, not
 * stranded, regardless of what `resolveActionCost` reports for anyone else.
 *
 * Restores (#1090 follow-up, TODO left by the vehicle-fleet migration phase 4
 * implementer in EmployeeDispatchSteps.ts) the release half of the deleted
 * `canReassignStrandedReservation` (VehicleReservation.ts, #954 follow-up),
 * now judged by the same real reachability check every other claim/release
 * decision in this module already uses instead of that function's own
 * weaker "nobody has boarded yet" heuristic — an employee who simply hasn't
 * started walking yet also has `vehicle.driverId === null`, so pairing that
 * with a genuine `resolveActionCost` failure is what distinguishes actually
 * stranded from merely not-yet-started.
 *
 * Assumes/requires the caller only passes a vehicle-gated action currently
 * held by `employee` (e.g. sourced from `employee.taskQueue`); this function
 * does not itself verify taskQueue membership.
 */
export function canReleaseStrandedVehicleGatedAction(
  state: GameState,
  employee: Employee,
  action: PendingAction,
): boolean {
  if (action.requiredVehicleRole === null) return false;
  const vehicle = state.vehicles.vehicles.find(v => v.reservedForActionId === action.id);
  if (!vehicle || vehicle.driverId !== null) return false;
  if (resolveActionCost(state, employee, action) !== null) return false;

  const role = action.requiredVehicleRole;
  return state.employees.employees.some(other =>
    other.id !== employee.id &&
    other.alive &&
    other.activeActionId === null &&
    other.restTicksRemaining === null &&
    isLicensedForRole(other, role),
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
 * real `findExactPath` resolution — every attempt in the bounded loop is now
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
 * The three-clause "is this queued action open to `employee`" check used by
 * `findStarvedActionForEmployee` below: still `queued`, untargeted or
 * targeted at `employee`, and `employee` holds `requiredSkill` when one is
 * set. Its caller layers its own extra clauses on top (vehicle role,
 * evacuation hold, staleness threshold) — this helper knows about none of
 * them, so the caller's clause can change without touching this one.
 */
function isQueuedActionAvailableToEmployee(employee: Employee, action: PendingAction): boolean {
  return action.status === 'queued' &&
    (action.targetEmployeeId === null || action.targetEmployeeId === employee.id) &&
    (action.requiredSkill === null || employee.qualifications.some(q => q.category === action.requiredSkill));
}

/**
 * Finds a queued, unclaimed, `requiredVehicleRole === null` action that has
 * been waiting at least `ACTION_STARVATION_TICK_THRESHOLD` ticks and is
 * claimable by `employee` — called from EmployeeDispatchSteps.ts's
 * `fillIdleEmployeeFromQueueOrPool` (`promoteStarved`), ahead of resuming an
 * ordinary taskQueue entry or claiming from the open pool, so a long-starved
 * on-foot action can win dispatch over whatever a same-role, still-mounted
 * driver would otherwise rank cheapest (#1000).
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

  // Each candidate's estimate is computed exactly once, up front, rather
  // than inside the comparator: the ore-priority bonus resolves the
  // action's fragment, and a comparator re-resolving it O(n log n) times
  // over a post-blast pool of thousands is the same per-tick blow-up
  // createFragmentLookup exists for (HaulDispatch.ts). Same order as
  // before — cost ascending, id ascending on a tie.
  const fragmentOf = createFragmentLookup(state);
  const costed = claimable.map(action => ({ action, cost: estimateActionCost(state, employee, action, fragmentOf) }));
  costed.sort((a, b) => {
    const costDiff = a.cost - b.cost;
    return costDiff !== 0 ? costDiff : a.action.id - b.action.id;
  });
  const ranked = costed.map(c => c.action);

  // Cheap, exact pre-filter (#953): a candidate outside the employee's own
  // climb-aware reachable set (e.g. inside a fresh blast crater's walled-off
  // interior) can never be reached by any real findExactPath, so it's skipped
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
