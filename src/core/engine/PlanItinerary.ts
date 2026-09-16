// BlastSimulator2026 — planItinerary (#1088)
// Pure function that plans the ordered legs an employee would travel to
// reach a goal, at two fidelities: 'estimate' (octile heuristic, cheap,
// for action-cost ranking) and 'exact' (real pathfinding, for the
// executor). Nothing consumes this yet (phase 3a, see gameplay-vehicle-fleet).
// Read-only: never mutates state, never reserves/boards a vehicle.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { Goal, Itinerary, Leg } from './Itinerary.js';
import { octileHeuristic, findPath } from '../nav/Pathfinding.js';
import { AGENT_WALK_SPEED, VEHICLE_TRANSPORT_PLANNING_ENABLED, VEHICLE_SEAT_COUNT } from '../config/balance.js';
import { computeActionWorkTicks, cellsToTravelTicks } from './ActionSelection.js';
import { findFreeVehicleForRole } from './VehicleReservation.js';
import { isMounted, mountedVehicleId } from '../entities/EmployeeLocomotion.js';
import { getVehicleDefByTier, type Vehicle, type VehicleRole } from '../entities/Vehicle.js';

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
 */
function resolveGoal(state: GameState, employee: Employee, goal: Goal): ResolvedGoal | null {
  if (goal.kind === 'work') {
    const action = state.pendingActions.find(a => a.id === goal.actionId);
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
 * Also returns null when `findPath` reports `found: true` but its own
 * `clampToGrid` silently redirected an out-of-bounds (toX, toZ) onto the
 * nearest in-grid cell (Pathfinding.ts) — a "successful" path whose real
 * endpoint is not the leg's own destX/destZ. Locomotion's `isLegArrived`
 * checks the UNCLAMPED destX/destZ exactly, so a leg built from such a path
 * can never actually arrive: every following tick re-resolves the identical
 * clamped, already-there path, reports "moved" with zero real movement, and
 * never once hits a failed-path tick to trip the stuck-abandon safety net
 * (#1103, confirmed live: level1-playthrough-win.json's own `vehicle move 3
 * to:10,-2` — a corridor-clearing coordinate one row past the navmesh's own
 * south edge — parks employee #4 at the clamped (10,0) from tick 15 onward,
 * indefinitely, and EmployeeDispatch.ts's own mid-itinerary dispatch guard
 * (#1089) then correctly refuses to double-book them, permanently removing
 * one of three survivors from the roster for the rest of the run). Failing
 * the plan here — same outcome as a genuinely unreachable target — is what
 * the corridor-clearing use case already expects: the console's `vehicle
 * move` command surfaces "No route available" instead of installing a leg
 * that can never resolve.
 */
function estimateLegDistance(
  state: GameState,
  fidelity: PlanFidelity,
  agentId: number,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): number | null {
  if (fidelity === 'estimate' || state.navGrid === null) {
    return octileHeuristic(fromX, fromZ, toX, toZ);
  }

  const path = findPath(state.navGrid, { agentId, fromX, fromZ, toX, toZ, avoidVehicles: false });
  if (!path.found) return null;

  const last = path.waypoints[path.waypoints.length - 1];
  if (!last || last.x !== Math.floor(toX) || last.z !== Math.floor(toZ)) return null;

  return path.totalCost;
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
  const footDist = estimateLegDistance(state, fidelity, employee.id, employee.x, employee.z, vehicle.x, vehicle.z);
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
  opts?: { via?: number },
): Itinerary | null {
  const resolved = resolveGoal(state, employee, goal);
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

    const dist = estimateLegDistance(state, fidelity, employee.id, employee.x, employee.z, resolved.targetX, resolved.targetZ);
    if (dist === null) return null;

    const footLeg: Leg = {
      mode: 'foot',
      vehicleId: null,
      destX: resolved.targetX,
      destZ: resolved.targetZ,
      arrival: 'exact',
      onArrive: { kind: 'none' },
      estTicks: cellsToTravelTicks(dist, AGENT_WALK_SPEED),
    };

    return { legs: [footLeg], goal, workTicks: 0, estTotalTicks: footLeg.estTicks };
  }

  // Vehicle-gated: an explicit `via` hint names the vehicle outright; absent
  // that, reuse the reservation already made for this action, if any,
  // otherwise the cheapest free vehicle of the required role — same lookup
  // resolveVehicleGatedWalkTarget (ActionSelection.ts) uses.
  let vehicle: Vehicle | undefined;
  if (via !== undefined) {
    vehicle = state.vehicles.vehicles.find(v => v.id === via);
    if (!vehicle || !hasFreeSeatFor(vehicle, employee)) return null;
  } else {
    const reserved = resolved.actionId !== null
      ? state.vehicles.vehicles.find(v => v.reservedForActionId === resolved.actionId)
      : undefined;
    vehicle = reserved ?? findFreeVehicleForRole(state, role!, employee) ?? undefined;
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
  const driveDist = estimateLegDistance(state, fidelity, vehicle.id, driveFromX, driveFromZ, resolved.targetX, resolved.targetZ);
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
