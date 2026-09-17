// BlastSimulator2026 — planItinerary (#1088)
// Pure function that plans the ordered legs an employee would travel to
// reach a goal, at two fidelities: 'estimate' (octile heuristic, cheap,
// for action-cost ranking) and 'exact' (real pathfinding, for the
// executor). Nothing consumes this yet (phase 3a, see gameplay-vehicle-fleet).
// Read-only: never mutates state, never reserves/boards a vehicle.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { Goal, Itinerary, Leg } from './Itinerary.js';
import { octileHeuristic, findExactPath } from '../nav/Pathfinding.js';
import { AGENT_WALK_SPEED, VEHICLE_TRANSPORT_PLANNING_ENABLED, VEHICLE_SEAT_COUNT } from '../config/balance.js';
import { computeActionWorkTicks, cellsToTravelTicks } from './ActionSelection.js';
import { findFreeVehicleForRole } from './VehicleReservation.js';
import { isMounted, mountedVehicleId } from '../entities/EmployeeLocomotion.js';
import { getVehicleDefByTier, type Vehicle, type VehicleRole } from '../entities/Vehicle.js';
import { isDestinationOccupied } from './EntityMovementTick.js';
import { fragmentApproachCell } from '../economy/FragmentApproach.js';
import { isOversized } from '../mining/BlastCalc.js';
// Economy -> engine -> economy: findHaulDepotApproach (HaulingTask.ts) needs
// no vehicle/employee-claim machinery of its own, only a NavGrid lookup, so
// importing it here closes a cycle no differently than the existing
// MoveTo.ts -> PlanItinerary.ts -> VehicleReservation.ts one documented above
// — every edge is a function called from inside another function's body,
// never evaluated at module-load time.
import { findHaulDepotApproach } from '../economy/HaulingTask.js';

export type PlanFidelity = 'estimate' | 'exact';

/** Goal resolved to a travel target, the vehicle role (if any) it's gated behind, and its work ticks. */
interface ResolvedGoal {
  targetX: number;
  targetZ: number;
  requiredVehicleRole: VehicleRole | null;
  workTicks: number;
  /** The goal's own action id, for a 'work' goal — used to look up an already-reserved vehicle. Null for 'reposition'/'rest', which never carry a required vehicle role. */
  actionId: number | null;
}

/**
 * Step 1 of planItinerary: resolves `goal` to a travel target and its
 * vehicle-gating, or null when the goal names something that doesn't exist
 * (an action or building id that's gone).
 *
 * `actionHint`, when supplied for a 'work' goal, is used directly instead of
 * an `Array.find` over `state.pendingActions` for it (#1090 perf follow-up:
 * ActionSelection.ts's estimateActionCost/resolveActionCost already hold the
 * exact action they're costing — re-finding it by id here made ranking a
 * pool of N candidates O(N) per candidate, O(N²) overall, the same class of
 * two-growing-collections cost the pool itself already guards against
 * elsewhere via createFragmentLookup. Every other caller of planItinerary
 * (moveTo's own 'reposition'/'work' goals) has no such action in hand and
 * simply omits the hint, falling back to the lookup unchanged.
 */
function resolveGoal(state: GameState, employee: Employee, goal: Goal, actionHint?: PendingAction): ResolvedGoal | null {
  if (goal.kind === 'work') {
    const action = actionHint ?? state.pendingActions.find(a => a.id === goal.actionId);
    if (!action) return null;
    return {
      targetX: action.targetX,
      targetZ: action.targetZ,
      requiredVehicleRole: action.requiredVehicleRole,
      workTicks: computeActionWorkTicks(state, employee, action),
      actionId: action.id,
    };
  }

  if (goal.kind === 'reposition') {
    return { targetX: goal.x, targetZ: goal.z, requiredVehicleRole: null, workTicks: 0, actionId: null };
  }

  // 'rest'
  const building = state.buildings.buildings.find(b => b.id === goal.buildingId);
  if (!building) return null;
  return { targetX: building.x, targetZ: building.z, requiredVehicleRole: null, workTicks: 0, actionId: null };
}

/**
 * Distance oracle shared by every leg this planner produces. 'estimate' is
 * the cheap octile heuristic and never fails. 'exact' calls the real
 * pathfinder, falling back to the octile heuristic when no NavGrid exists
 * yet — mirroring resolveActionCost's own null-navGrid convention
 * (ActionSelection.ts) — and returns null when the target is genuinely
 * unreachable on the current NavGrid.
 *
 * Uses `findExactPath` (Pathfinding.ts) rather than `findPath` directly:
 * `findPath` can report `found: true` after its own `clampToGrid` silently
 * redirected an out-of-bounds (toX, toZ) onto the nearest in-grid cell — a
 * "successful" path whose real endpoint is not the leg's own destX/destZ.
 * `findExactPath` rejects exactly that case (#1109). Locomotion's
 * `isLegArrived` checks the UNCLAMPED destX/destZ exactly, so a leg built
 * from a clamped path can never actually arrive: every following tick
 * re-resolves the identical clamped, already-there path, reports "moved"
 * with zero real movement, and never once hits a failed-path tick to trip
 * the stuck-abandon safety net (#1103, confirmed live:
 * level1-playthrough-win.json's own `vehicle move 3 to:10,-2` — a
 * corridor-clearing coordinate one row past the navmesh's own south edge —
 * parks employee #4 at the clamped (10,0) from tick 15 onward, indefinitely,
 * and EmployeeDispatch.ts's own mid-itinerary dispatch guard (#1089) then
 * correctly refuses to double-book them, permanently removing one of three
 * survivors from the roster for the rest of the run). Failing the plan here
 * — same outcome as a genuinely unreachable target — is what the
 * corridor-clearing use case already expects: the console's `vehicle move`
 * command surfaces "No route available" instead of installing a leg that
 * can never resolve.
 *
 * `avoidVehicles` (#1090, #954): threaded straight through to
 * `findExactPath`, mirroring `resolveActionCost`'s own former occupancy rule
 * (ActionSelection.ts, deleted along with `resolveVehicleGatedWalkTarget`) and
 * `Locomotion.ts`'s own `advanceLeg` (the executor) now that goal resolution
 * (and its vehicle-gated walk target) also lives in this planner. A drive leg
 * always passes `false` (see the drive-leg call site's own comment below — a
 * drive leg routes around live vehicle occupancy at each step instead, not
 * via this static flag). A foot leg (including the leg to reach and board a
 * vehicle) passes `!isDestinationOccupied(state, toX, toZ)`: normally
 * `true` — an ordinary walk avoids every occupied cell (vehicle- or
 * fragment-occupied alike; `isCellOccupied` treats both as one obstacle) —
 * except when the leg's own destination is itself occupied (boarding a
 * vehicle sitting there, or charging a hole a drill_rig still sits on), which
 * flips it to `false` so the walk can reach that exact occupied cell instead
 * of refusing a route to it. A vehicle boxed in by other vehicles on every
 * neighbour cell is still reachable via its own board leg (destination = the
 * vehicle's own, always-occupied, cell); a target boxed in by FRAGMENT
 * occupancy with its own cell unoccupied stays correctly unreachable either
 * way, since that destination's own occupancy state is what the exemption
 * keys off, not the obstacle type blocking the cells around it.
 */
function estimateLegDistance(
  state: GameState,
  fidelity: PlanFidelity,
  agentId: number,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  avoidVehicles: boolean,
): number | null {
  if (fidelity === 'estimate' || state.navGrid === null) {
    return octileHeuristic(fromX, fromZ, toX, toZ);
  }

  const path = findExactPath(state.navGrid, { agentId, fromX, fromZ, toX, toZ, avoidVehicles });
  return path.found ? path.totalCost : null;
}

/**
 * The foot-to-vehicle leg every fresh (not-yet-mounted) vehicle-gated
 * itinerary starts with: walk to within one tile of `vehicle` and board it.
 * Shared by planItinerary's own vehicle-gated branch below and MoveTo.ts's
 * board-only itinerary (`moveTo(state, id, {vehicleId})`), which is exactly
 * this one leg with nothing appended after it.
 */
export function buildBoardLeg(
  state: GameState,
  employee: Employee,
  vehicle: Vehicle,
  fidelity: PlanFidelity,
): Leg | null {
  const footDist = estimateLegDistance(state, fidelity, employee.id, employee.x, employee.z, vehicle.x, vehicle.z, !isDestinationOccupied(state, vehicle.x, vehicle.z));
  if (footDist === null) return null;

  return {
    mode: 'foot',
    vehicleId: vehicle.id,
    destX: vehicle.x,
    destZ: vehicle.z,
    arrival: 'adjacent',
    onArrive: { kind: 'board', vehicleId: vehicle.id },
    estTicks: cellsToTravelTicks(footDist, AGENT_WALK_SPEED),
  };
}

/**
 * Whether `vehicle` has a free seat for `employee` — already aboard counts as
 * free (continuity never needs a second seat). Shared with MoveTo.ts's
 * board-only itinerary, which runs the identical availability check before
 * committing to a route.
 */
export function hasFreeSeatFor(vehicle: Vehicle, employee: Employee): boolean {
  return vehicle.occupantIds.includes(employee.id) || vehicle.occupantIds.length < VEHICLE_SEAT_COUNT[vehicle.type];
}

/**
 * Resolves which vehicle a vehicle-gated goal drives: an explicit `via` hint
 * names it outright (must still have a free seat); absent that, reuse the
 * reservation already made for `reservedActionId`, if any, otherwise the
 * cheapest free vehicle of `role`. Shared by planItinerary's own generic
 * vehicle-gated branch and planFragmentTaskItinerary below — both resolve a
 * goal's vehicle identically, differing only in what they build the
 * itinerary out of once they have it (#1091).
 */
function resolveVehicleForGoal(
  state: GameState,
  employee: Employee,
  role: VehicleRole,
  via: number | undefined,
  reservedActionId: number | null,
): Vehicle | null {
  if (via !== undefined) {
    const vehicle = state.vehicles.vehicles.find(v => v.id === via);
    return vehicle && hasFreeSeatFor(vehicle, employee) ? vehicle : null;
  }

  const reserved = reservedActionId !== null
    ? state.vehicles.vehicles.find(v => v.reservedForActionId === reservedActionId)
    : undefined;
  return reserved ?? findFreeVehicleForRole(state, role, employee) ?? null;
}

/**
 * A zero-length alight leg for an employee currently mounted in a DIFFERENT
 * vehicle than the one they're about to board — null when not mounted at
 * all (nothing to alight from first). #1103: without this, a foot leg
 * walking to board a new vehicle would move employee.x/z on its own while
 * the old vehicle, whose x/z is written only from ITS OWN occupant's advance
 * (Locomotion.ts), never moves, instantly splitting the two positions apart
 * (I2). Applying the 'alight' step the very same tick it becomes current
 * (Locomotion.advanceItinerary's own continuity-leg handling) avoids idling a
 * tick for a movement that would never fire. Shared by planItinerary's own
 * generic vehicle-gated branch and planFragmentTaskItinerary below (#1091).
 */
function buildAlightLegIfMountedElsewhere(employee: Employee): Leg | null {
  if (!isMounted(employee.locomotion)) return null;
  return {
    mode: 'foot',
    vehicleId: null,
    destX: employee.x,
    destZ: employee.z,
    arrival: 'exact',
    onArrive: { kind: 'alight' },
    estTicks: 0,
  };
}

/**
 * A single foot leg straight from `employee`'s own position to
 * (`targetX`, `targetZ`), at walking speed, plus `workTicks` of work once
 * there. Shared by planItinerary's own no-vehicle-role branch and its
 * no-vehicle-available fallback for a vehicle-gated goal (see that call
 * site's own doc comment) — both plan the identical single-leg itinerary,
 * differing only in why no vehicle enters the route. Returns null when the
 * target is unreachable, same "stays queued, retries next tick" contract as
 * planItinerary itself.
 */
function buildFootOnlyItinerary(
  state: GameState,
  employee: Employee,
  goal: Goal,
  fidelity: PlanFidelity,
  targetX: number,
  targetZ: number,
  workTicks: number,
): Itinerary | null {
  const dist = estimateLegDistance(state, fidelity, employee.id, employee.x, employee.z, targetX, targetZ, !isDestinationOccupied(state, targetX, targetZ));
  if (dist === null) return null;

  const footLeg: Leg = {
    mode: 'foot',
    vehicleId: null,
    destX: targetX,
    destZ: targetZ,
    arrival: 'exact',
    onArrive: { kind: 'none' },
    estTicks: cellsToTravelTicks(dist, AGENT_WALK_SPEED),
  };

  return { legs: [footLeg], goal, workTicks, estTotalTicks: footLeg.estTicks + workTicks };
}

/**
 * Plans a haul_debris/fragment_debris work goal's itinerary: the fragment-
 * targeting drive leg(s) — to the fragment, and for a haul, on to the depot —
 * each ending in an ArrivalEffects.ts effect (`haul_load`, `haul_unload`,
 * `boulder_split`) rather than the generic single-target-then-work shape
 * `planItinerary`'s own fallback below builds for every other action type.
 * Split out because these two action types are the only ones needing more
 * than one drive leg to reach their work (#1091 — see HaulingTask.ts's and
 * BoulderBreaking.ts's own reduced surface, which used to drive this
 * themselves via tickHaulingProgress/tickBreakProgress phase machines on
 * `Vehicle`).
 */
export function planFragmentTaskItinerary(
  state: GameState,
  employee: Employee,
  goal: Goal,
  fidelity: PlanFidelity,
  action: PendingAction,
  opts?: { via?: number },
): Itinerary | null {
  const role = action.requiredVehicleRole;
  if (role === null) return null; // defensive — both action types always carry a role

  const vehicle = resolveVehicleForGoal(state, employee, role, opts?.via, action.id);
  if (!vehicle) return null;

  const fragmentId = action.payload['fragmentId'];
  if (typeof fragmentId !== 'number') return null;

  const alreadyMounted = isMounted(employee.locomotion) && mountedVehicleId(employee.locomotion) === vehicle.id;
  const legs: Leg[] = [];
  let driveFromX = employee.x;
  let driveFromZ = employee.z;

  if (!alreadyMounted) {
    const alightLeg = buildAlightLegIfMountedElsewhere(employee);
    if (alightLeg) legs.push(alightLeg);

    const boardLeg = buildBoardLeg(state, employee, vehicle, fidelity);
    if (boardLeg === null) return null;
    legs.push(boardLeg);

    driveFromX = vehicle.x;
    driveFromZ = vehicle.z;
  }

  const def = getVehicleDefByTier(vehicle.type, vehicle.tier);

  // Resume-after-interruption (#1091): the reserved vehicle already carries
  // this exact fragment as payload — its haul_load leg already ran before an
  // earlier policy-driven interruption/pause left the reservation (and the
  // cargo) intact rather than releasing it (isCommittedToOwnCargo,
  // VehicleReservation.ts). Only the depot leg is left to plan.
  if (action.type === 'haul_debris' && vehicle.payload !== null && vehicle.payload.fragmentId === fragmentId) {
    const depotApproach = findHaulDepotApproach(state, driveFromX, driveFromZ);
    if (depotApproach === null) return null;

    const driveDist = estimateLegDistance(state, fidelity, vehicle.id, driveFromX, driveFromZ, depotApproach.x, depotApproach.z, false);
    if (driveDist === null) return null;

    legs.push({
      mode: 'drive',
      vehicleId: vehicle.id,
      destX: depotApproach.x,
      destZ: depotApproach.z,
      arrival: 'exact',
      onArrive: { kind: 'effect', effectId: 'haul_unload' },
      estTicks: cellsToTravelTicks(driveDist, def.speed),
    });

    return { legs, goal, workTicks: 0, estTotalTicks: legs.reduce((sum, leg) => sum + leg.estTicks, 0) };
  }

  // A fresh haul, or a break — both start with a drive to the fragment
  // itself. Re-validated here (not just at claim time): the fragment must
  // still be on_ground, and (haul only) not have become oversized, or
  // (break only) still be oversized, by the time this itinerary is actually
  // planned/replanned.
  const tracked = state.logistics.fragments.find(f => f.fragment.id === fragmentId && f.state === 'on_ground');
  if (!tracked) return null;
  if (action.type === 'fragment_debris' && !isOversized(tracked.fragment.volume)) return null;
  if (action.type === 'haul_debris' && isOversized(tracked.fragment.volume)) return null;

  const approach = fragmentApproachCell(tracked.fragment, state, vehicle.id);
  const toFragmentDist = estimateLegDistance(state, fidelity, vehicle.id, driveFromX, driveFromZ, approach.x, approach.z, false);
  if (toFragmentDist === null) return null;

  legs.push({
    mode: 'drive',
    vehicleId: vehicle.id,
    destX: approach.x,
    destZ: approach.z,
    arrival: 'exact',
    onArrive: { kind: 'effect', effectId: action.type === 'haul_debris' ? 'haul_load' : 'boulder_split' },
    estTicks: cellsToTravelTicks(toFragmentDist, def.speed),
  });

  if (action.type === 'fragment_debris') {
    return { legs, goal, workTicks: 0, estTotalTicks: legs.reduce((sum, leg) => sum + leg.estTicks, 0) };
  }

  // haul_debris: one more leg on to the depot — no active one means this
  // goal stays unresolvable, same "stays queued, retries next tick" contract
  // as every other null return in this file.
  const depotApproach = findHaulDepotApproach(state, approach.x, approach.z);
  if (depotApproach === null) return null;

  const toDepotDist = estimateLegDistance(state, fidelity, vehicle.id, approach.x, approach.z, depotApproach.x, depotApproach.z, false);
  if (toDepotDist === null) return null;

  legs.push({
    mode: 'drive',
    vehicleId: vehicle.id,
    destX: depotApproach.x,
    destZ: depotApproach.z,
    arrival: 'exact',
    onArrive: { kind: 'effect', effectId: 'haul_unload' },
    estTicks: cellsToTravelTicks(toDepotDist, def.speed),
  });

  return { legs, goal, workTicks: 0, estTotalTicks: legs.reduce((sum, leg) => sum + leg.estTicks, 0) };
}

export function planItinerary(
  state: GameState,
  employee: Employee,
  goal: Goal,
  fidelity: PlanFidelity,
  // #1089: a caller-supplied vehicle hint — moveTo's `via` — names the exact
  // vehicle to plan a reposition goal through, overriding the goal's own
  // (null, for 'reposition') role-based selection below. Reused by a 'work'
  // goal too (harmless: no caller passes both today), so the override lives
  // in one place rather than being special-cased per goal kind.
  // `action`, for a 'work' goal, is a perf-only hint — see resolveGoal's own
  // doc comment (#1090).
  opts?: { via?: number; action?: PendingAction },
): Itinerary | null {
  // haul_debris/fragment_debris (#1091): these two action types need more
  // than the generic single-drive-leg-then-work shape the rest of this
  // function builds, so they're diverted to their own planner up front —
  // see planFragmentTaskItinerary's own doc comment.
  if (goal.kind === 'work') {
    const action = opts?.action ?? state.pendingActions.find(a => a.id === goal.actionId);
    if (action && (action.type === 'haul_debris' || action.type === 'fragment_debris')) {
      return planFragmentTaskItinerary(state, employee, goal, fidelity, action, opts);
    }
  }

  const resolved = resolveGoal(state, employee, goal, opts?.action);
  if (resolved === null) return null;

  const role = resolved.requiredVehicleRole;
  // A 'reposition' goal carries no role of its own — an employee already
  // mounted planning one implicitly keeps driving the vehicle they're in
  // (Zone.ts's already-driven-relocate case: `moveTo(state, v.driverId, {x,
  // z})`, no explicit `via`) rather than stepping off it to walk, which
  // would desync their position from the vehicle's (I2) without ever
  // alighting. An explicit `via` always wins when both are present.
  const via = opts?.via ?? (
    goal.kind === 'reposition' && isMounted(employee.locomotion)
      ? mountedVehicleId(employee.locomotion) ?? undefined
      : undefined
  );

  if (role === null && via === undefined) {
    if (VEHICLE_TRANSPORT_PLANNING_ENABLED) {
      /* reserved for gameplay-vehicle-fleet phase 7 (fast transport): compare
       * this foot leg's cost against boarding+driving and return whichever is
       * cheaper. Not built in phase 3a. */
    }

    return buildFootOnlyItinerary(state, employee, goal, fidelity, resolved.targetX, resolved.targetZ, resolved.workTicks);
  }

  // Vehicle-gated: an explicit `via` hint names the vehicle outright; absent
  // that, reuse the reservation already made for this action, if any,
  // otherwise the cheapest free vehicle of the required role — same lookup
  // resolveVehicleGatedWalkTarget (ActionSelection.ts, deleted along with
  // this whole function) used. #1090: unlike a "defensive" fallback to a
  // plain on-foot walk when no vehicle is reserved or free, planItinerary
  // reports this goal genuinely unresolvable — a vehicle-gated action has no
  // valid on-foot substitute, so a route that doesn't actually exist in the
  // real dispatch (no vehicle to drive) must not be costed as though it
  // does. Matches findVehicleForClaim's own real dispatch-time refusal in
  // this state.
  const vehicle = resolveVehicleForGoal(state, employee, role!, via, resolved.actionId);
  if (!vehicle) return null;

  const alreadyMounted = isMounted(employee.locomotion) && mountedVehicleId(employee.locomotion) === vehicle.id;

  const legs: Leg[] = [];
  let driveFromX = employee.x;
  let driveFromZ = employee.z;

  if (!alreadyMounted) {
    const alightLeg = buildAlightLegIfMountedElsewhere(employee);
    if (alightLeg) legs.push(alightLeg);

    const boardLeg = buildBoardLeg(state, employee, vehicle, fidelity);
    if (boardLeg === null) return null;
    legs.push(boardLeg);

    driveFromX = vehicle.x;
    driveFromZ = vehicle.z;
  }

  const def = getVehicleDefByTier(vehicle.type, vehicle.tier);
  // Drive leg: avoidVehicles: false, mirroring Locomotion.ts's own
  // advanceLeg (the executor) — a drive leg ignores NavCell.vehicleOccupied
  // entirely at the static-pathfinding level (a vehicle must be able to
  // drive onto another vehicle's or a fragment's cell to interact with it)
  // and instead routes around a live vehicle-vs-vehicle occupancy check at
  // each step, not baked into this route-cost estimate.
  const driveDist = estimateLegDistance(state, fidelity, vehicle.id, driveFromX, driveFromZ, resolved.targetX, resolved.targetZ, false);
  if (driveDist === null) return null;

  legs.push({
    mode: 'drive',
    vehicleId: vehicle.id,
    destX: resolved.targetX,
    destZ: resolved.targetZ,
    arrival: 'exact',
    onArrive: { kind: 'none' },
    estTicks: cellsToTravelTicks(driveDist, def.speed),
  });

  const estTotalTicks = legs.reduce((sum, leg) => sum + leg.estTicks, 0) + resolved.workTicks;
  return { legs, goal, workTicks: resolved.workTicks, estTotalTicks };
}
