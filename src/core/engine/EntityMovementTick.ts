// BlastSimulator2026 — Per-tick movement for vehicles and employees.
// Extracted from GameLoop.ts (#407 refactor) — both steppers share the same
// find-path/advance pipeline (AgentAdvance.advanceAlongPath) and were added
// together to wire vehicles and employees onto the NavGrid, so they live in
// one cohesive module rather than the general tick orchestration in GameLoop.ts.
// VehicleOccupancyReroute.ts holds the occupancy-block reroute/escalation
// logic, split out once it pushed this file past the 300-line limit (#591).

import type { GameState } from '../state/GameState.js';
import { getVehicleDefByTier, type Vehicle } from '../entities/Vehicle.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { findPath } from '../nav/Pathfinding.js';
import { advanceAlongPath } from '../nav/AgentAdvance.js';
import { AGENT_WALK_SPEED, STUCK_MORALE_PENALTY } from '../config/balance.js';
import { applyAdvanceOutcome, handleVehicleOccupancyBlock } from './VehicleOccupancyReroute.js';

export { findPathAvoidingOtherVehicles } from './VehicleOccupancyReroute.js';

// ── Vehicle movement ──

/**
 * Process one vehicle movement step toward vehicle.targetX/targetZ.
 *
 * With a NavGrid built (state.navGrid !== null), routes via Pathfinding.findPath
 * and advances via AgentMovement.advanceAgent — the same pipeline
 * tickEmployeeMovement uses — so ramps, blocked cells, and NavCell move costs
 * (walkable:1.0, ramp:1.8, drill_hole:5.0, blocked/void: impassable) all affect
 * a vehicle's route exactly as they do an employee's. Previously this stepped
 * a flat one grid cell per tick in a straight line, ignoring the NavGrid
 * entirely regardless of terrain (#407).
 *
 * With no NavGrid yet (e.g. before a world is generated), falls back to the
 * original direct-line, one-cell-per-tick stepper — unchanged from before
 * this fix, and still exercised by callers/tests that construct a GameState
 * without a NavGrid.
 *
 * Vehicle-vs-vehicle collision avoidance primarily checks other vehicles'
 * live x/z via isCellOccupiedByOtherVehicle before committing to the next
 * grid cell (only the immediate one, not every cell a multi-cell-per-tick
 * vehicle crosses in one tick). NavCell.vehicleOccupied stays unused by that
 * check; VehicleOccupancyReroute.ts's handleVehicleOccupancyBlock is the one
 * caller that sets it, temporarily, once waitingTicks crosses
 * VEHICLE_OCCUPANCY_REROUTE_THRESHOLD on a blocked next cell (#591).
 */
export function tickVehicle(state: GameState, vehicle: Vehicle, emitter?: EventEmitter): void {
  if (!canTickVehicle(vehicle)) return;

  if (vehicle.x === vehicle.targetX && vehicle.z === vehicle.targetZ) {
    setVehicleIdle(vehicle);
    return;
  }

  if (state.navGrid) {
    tickVehicleOnNavGrid(state, vehicle, emitter);
  } else {
    tickVehicleDirectLine(state, vehicle);
  }
}

/** Original pre-#407 stepper: one grid cell per tick in a straight line, ignoring terrain. */
function tickVehicleDirectLine(state: GameState, vehicle: Vehicle): void {
  const deltaX = vehicle.targetX - vehicle.x;
  const deltaZ = vehicle.targetZ - vehicle.z;

  let nextX = vehicle.x;
  let nextZ = vehicle.z;
  if (deltaX !== 0) {
    nextX += Math.sign(deltaX);
  } else if (deltaZ !== 0) {
    nextZ += Math.sign(deltaZ);
  }

  if (isCellOccupiedByOtherVehicle(state, vehicle, nextX, nextZ)) {
    markVehicleWaiting(vehicle);
    return;
  }

  vehicle.x = nextX;
  vehicle.z = nextZ;
  vehicle.state = 'moving';
  vehicle.waitingTicks = 0;

  if (vehicle.x === vehicle.targetX && vehicle.z === vehicle.targetZ) {
    setVehicleIdle(vehicle);
  }
}

/** NavGrid-aware stepper: routes via A*, respects move costs, tracks stuck state. */
function tickVehicleOnNavGrid(state: GameState, vehicle: Vehicle, emitter?: EventEmitter): void {
  // Captured before the top-level findPath/advanceAlongPath call below, which
  // always succeeds here (findPath ignores vehicle occupancy) and so always
  // resets vehicle.isMoveStuck to false via outcome.isStuck — clobbering any
  // stuck state set by a PRIOR tick's occupancy-escalation branch before this
  // tick's own occupancy check gets a chance to read it. Without this capture,
  // the rising-edge guard below always reads false and re-emits every tick.
  const wasStuckBeforeTick = vehicle.isMoveStuck;

  const path = findPath(state.navGrid!, {
    agentId: vehicle.id,
    fromX: vehicle.x,
    fromZ: vehicle.z,
    toX: vehicle.targetX,
    toZ: vehicle.targetZ,
    avoidVehicles: false,
  });

  const outcome = advanceAlongPath({
    x: vehicle.x,
    z: vehicle.z,
    walkSpeed: getVehicleDefByTier(vehicle.type, vehicle.tier).speed,
    destinationX: vehicle.targetX,
    destinationZ: vehicle.targetZ,
    consecutiveFailures: vehicle.moveConsecutiveFailures,
    isStuck: vehicle.isMoveStuck,
    path,
  });

  vehicle.moveConsecutiveFailures = outcome.consecutiveFailures;
  vehicle.isMoveStuck = outcome.isStuck;

  if (!outcome.pathFound) {
    if (outcome.becameStuck) {
      emitter?.emit('vehicle:stuck', { vehicleId: vehicle.id });
    }
    markVehicleWaiting(vehicle);
    return;
  }

  const nextStep = nextGridStep(vehicle, path.waypoints);
  if (nextStep && isCellOccupiedByOtherVehicle(state, vehicle, nextStep.x, nextStep.z)) {
    handleVehicleOccupancyBlock(state, vehicle, emitter, wasStuckBeforeTick);
    return;
  }

  applyAdvanceOutcome(vehicle, outcome, outcome.isStuck);
}

/** The immediate next grid cell along a found path — the one occupancy is checked against. */
function nextGridStep(
  vehicle: Vehicle,
  waypoints: Array<{ x: number; z: number }>,
): { x: number; z: number } | null {
  if (waypoints.length === 0) return null;
  const first = waypoints[0]!;
  const atFirst = Math.floor(vehicle.x) === first.x && Math.floor(vehicle.z) === first.z;
  if (atFirst && waypoints.length > 1) return waypoints[1]!;
  return first;
}

export function markVehicleWaiting(vehicle: Vehicle): void {
  if (vehicle.state !== 'waiting') {
    vehicle.state = 'waiting';
    vehicle.waitingTicks = 1;
  } else {
    vehicle.waitingTicks = (vehicle.waitingTicks ?? 0) + 1;
  }
}

function canTickVehicle(vehicle: Vehicle): boolean {
  // moveVehicle() sets task='moving'; vehicle state may still be 'idle' on the very first
  // tick, or 'working' when a caller just switched task off a work task (e.g. HaulingTask's
  // to_fragment->pickup->to_depot transition leaves state='working' from the tick it loaded —
  // #437). task is the sole authority on whether a vehicle should move; state is a derived
  // display value tickVehicleTaskState/tickVehicle themselves update, so it must never block
  // a 'moving' task from actually ticking.
  return vehicle.task === 'moving' &&
    (vehicle.state === 'idle' || vehicle.state === 'moving' || vehicle.state === 'waiting' || vehicle.state === 'working');
}

export function setVehicleIdle(vehicle: Vehicle): void {
  vehicle.task = 'idle';
  vehicle.state = 'idle';
  vehicle.waitingTicks = 0;
}

function isCellOccupiedByOtherVehicle(state: GameState, vehicle: Vehicle, x: number, z: number): boolean {
  return state.vehicles.vehicles.some(v => v.id !== vehicle.id && v.x === x && v.z === z);
}

// ── Vehicle task/work state ──

/**
 * Transitions vehicle.state to 'working' while vehicle.task is one of the
 * work tasks ('transport' | 'loading' | 'drilling' | 'clearing'), and back to
 * 'idle' when task returns to 'idle'. VehicleOperationalState.working was
 * never assigned anywhere prior to this (#411) — vehicle-task-states-visual's
 * working-state screenshot was unreachable.
 *
 * Called per vehicle alongside tickVehicle in the tick loop (events.ts step 8f).
 */
const WORK_TASKS: ReadonlySet<Vehicle['task']> = new Set(['transport', 'loading', 'drilling', 'clearing']);

export function tickVehicleTaskState(vehicle: Vehicle): void {
  if (WORK_TASKS.has(vehicle.task)) {
    vehicle.state = 'working';
  } else if (vehicle.task === 'idle') {
    vehicle.state = 'idle';
  }
}

// ── Employee movement ──

export interface EmployeeMovementResult {
  /** Employee IDs that advanced position this tick. */
  moved: number[];
  /** Employee IDs that reached destinationX/destinationZ this tick. */
  arrived: number[];
  /** Employee IDs that newly entered the stuck state this tick. */
  stuck: number[];
}

/**
 * Advance every alive employee with a destination (set by tickEmployees on
 * claim, or by the rest self-claim paths in tickCollapse/tickNeedRestoration/
 * forceShiftRestIfNeeded, all in GameLoop.ts) one tick's worth of movement
 * toward it, using the NavGrid-aware A* pathfinder (Pathfinding.findPath) and
 * the generic per-tick advancer (AgentMovement.advanceAgent) — the "already
 * implemented, already unit-tested" navmesh pieces that nothing wired to a
 * caller before.
 *
 * The path is recomputed fresh every tick rather than cached on the employee:
 * this doubles as the "re-request from current position" behaviour the
 * gameplay-navmesh spec calls for whenever the next step is blocked, without
 * needing to persist a waypoint list on GameState. A path that repeatedly
 * fails to resolve (STUCK_THRESHOLD consecutive ticks) marks the employee
 * stuck — idle, morale −2/tick — until the grid changes and a path resolves
 * again, at which point movement resumes on its own the very next tick.
 *
 * With no NavGrid built yet (state.navGrid === null), falls back to a direct
 * line toward the destination, ignoring obstacles — better than the total
 * non-movement this replaces, and consistent with tickVehicle's own
 * pre-navmesh behaviour.
 */
export function tickEmployeeMovement(state: GameState, emitter?: EventEmitter): EmployeeMovementResult {
  const result: EmployeeMovementResult = { moved: [], arrived: [], stuck: [] };

  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    if (emp.destinationX === null || emp.destinationZ === null) continue;

    if (emp.x === emp.destinationX && emp.z === emp.destinationZ) {
      emp.destinationX = null;
      emp.destinationZ = null;
      continue;
    }

    const path = state.navGrid
      ? findPath(state.navGrid, {
        agentId: emp.id,
        fromX: emp.x,
        fromZ: emp.z,
        toX: emp.destinationX,
        toZ: emp.destinationZ,
        avoidVehicles: false,
      })
      // No NavGrid yet: synthesize a direct two-point path (start, destination) —
      // findPath is never called, so this always "succeeds", matching the
      // pre-navmesh direct-line fallback tickVehicle also falls back to.
      : { found: true, waypoints: [{ x: emp.x, z: emp.z }, { x: emp.destinationX, z: emp.destinationZ }] };

    const outcome = advanceAlongPath({
      x: emp.x,
      z: emp.z,
      walkSpeed: AGENT_WALK_SPEED,
      destinationX: emp.destinationX,
      destinationZ: emp.destinationZ,
      consecutiveFailures: emp.moveConsecutiveFailures,
      isStuck: emp.isMoveStuck,
      path,
    });

    emp.moveConsecutiveFailures = outcome.consecutiveFailures;
    emp.isMoveStuck = outcome.isStuck;

    if (!outcome.pathFound) {
      if (emp.isMoveStuck) {
        if (outcome.becameStuck) {
          result.stuck.push(emp.id);
          emitter?.emit('agent:stuck', { employeeId: emp.id });
        }
        emp.morale = Math.max(0, emp.morale - STUCK_MORALE_PENALTY);
      }
      continue;
    }

    emp.x = outcome.x;
    emp.z = outcome.z;
    result.moved.push(emp.id);

    if (outcome.isPathComplete) {
      emp.x = emp.destinationX;
      emp.z = emp.destinationZ;
      emp.destinationX = null;
      emp.destinationZ = null;
      result.arrived.push(emp.id);
    }
  }

  return result;
}
