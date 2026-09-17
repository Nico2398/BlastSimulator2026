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
export function estimateLegDistance(
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
  // this whole function) used.
  let vehicle: Vehicle | undefined;
  if (via !== undefined) {
    vehicle = state.vehicles.vehicles.find(v => v.id === via);
    if (!vehicle || !hasFreeSeatFor(vehicle, employee)) return null;
  } else {
    const reserved = resolved.actionId !== null
      ? state.vehicles.vehicles.find(v => v.reservedForActionId === resolved.actionId)
      : undefined;
    vehicle = reserved ?? findFreeVehicleForRole(state, role!, employee) ?? undefined;
    // #1090: unlike the deleted resolveVehicleGatedWalkTarget's own
    // "defensive" fallback to a plain on-foot walk when no vehicle is
    // reserved or free, planItinerary reports this goal genuinely
    // unresolvable — a vehicle-gated action has no valid on-foot substitute,
    // so a route that doesn't actually exist in the real dispatch (no
    // vehicle to drive) must not be costed as though it does. Matches
    // findVehicleForClaim's own real dispatch-time refusal in this state.
    if (!vehicle) return null;
  }

  const alreadyMounted = isMounted(employee.locomotion) && mountedVehicleId(employee.locomotion) === vehicle.id;

  const legs: Leg[] = [];
  let driveFromX = employee.x;
  let driveFromZ = employee.z;

  if (!alreadyMounted) {
    // #1103: an employee currently mounted in a DIFFERENT vehicle (e.g. an
    // idle rock_digger driver picked up for a debris_hauler haul) must alight
    // from it before walking to board this one — otherwise the foot leg
    // below moves employee.x/z on its own while the old vehicle, whose x/z is
    // written only from ITS OWN occupant's advance (Locomotion.ts), never
    // moves, instantly splitting the two positions apart (I2). A zero-length
    // leg at the employee's own current position applies its 'alight' step
    // the very same tick it becomes current (Locomotion.advanceItinerary's
    // own continuity-leg handling) rather than idling a tick for a movement
    // that would never fire.
    if (isMounted(employee.locomotion)) {
      legs.push({
        mode: 'foot',
        vehicleId: null,
        destX: employee.x,
        destZ: employee.z,
        arrival: 'exact',
        onArrive: { kind: 'alight' },
        estTicks: 0,
      });
    }

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
