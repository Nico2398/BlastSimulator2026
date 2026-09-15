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
import { AGENT_WALK_SPEED, VEHICLE_TRANSPORT_PLANNING_ENABLED } from '../config/balance.js';
import { computeActionWorkTicks, cellsToTravelTicks } from './ActionSelection.js';
import { findFreeVehicleForRole } from './VehicleReservation.js';
import { isMounted, mountedVehicleId } from '../entities/EmployeeLocomotion.js';
import { getVehicleDefByTier, type VehicleRole } from '../entities/Vehicle.js';

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
  return path.found ? path.totalCost : null;
}

export function planItinerary(
  state: GameState,
  employee: Employee,
  goal: Goal,
  fidelity: PlanFidelity,
): Itinerary | null {
  const resolved = resolveGoal(state, employee, goal);
  if (resolved === null) return null;

  const role = resolved.requiredVehicleRole;

  if (role === null) {
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

  // Vehicle-gated: reuse the reservation already made for this action, if
  // any, otherwise the cheapest free vehicle of the required role — same
  // lookup resolveVehicleGatedWalkTarget (ActionSelection.ts) uses.
  const reserved = resolved.actionId !== null
    ? state.vehicles.vehicles.find(v => v.reservedForActionId === resolved.actionId)
    : undefined;
  const vehicle = reserved ?? findFreeVehicleForRole(state, role, employee);
  if (!vehicle) return null;

  const alreadyMounted = isMounted(employee.locomotion) && mountedVehicleId(employee.locomotion) === vehicle.id;

  const legs: Leg[] = [];
  let driveFromX = employee.x;
  let driveFromZ = employee.z;

  if (!alreadyMounted) {
    const footDist = estimateLegDistance(state, fidelity, employee.id, employee.x, employee.z, vehicle.x, vehicle.z);
    if (footDist === null) return null;

    legs.push({
      mode: 'foot',
      vehicleId: vehicle.id,
      destX: vehicle.x,
      destZ: vehicle.z,
      arrival: 'adjacent',
      onArrive: { kind: 'board', vehicleId: vehicle.id },
      estTicks: cellsToTravelTicks(footDist, AGENT_WALK_SPEED),
    });

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
