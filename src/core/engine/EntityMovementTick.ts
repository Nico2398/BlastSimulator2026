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
import { AGENT_WALK_SPEED, STUCK_MORALE_PENALTY, MOVE_STUCK_ABANDON_TICKS } from '../config/balance.js';
import { applyAdvanceOutcome, handleVehicleOccupancyBlock } from './VehicleOccupancyReroute.js';
import { interruptActiveAction } from './TaskDispatch.js';

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
  // tickVehicleMovement reports (via its return value) whether the vehicle
  // was actually driving this tick — syncing must NOT run when it wasn't
  // (task !== 'moving' on entry, e.g. a driver assigned to a vehicle that
  // hasn't been dispatched anywhere yet): an employee who holds driverId of
  // a parked vehicle is free to be dispatched to an unrelated on-foot task
  // (nothing clears driverId when that happens — see
  // ActionSelection/EmployeeDispatch, which never consult it), and syncing
  // unconditionally every tick regardless of whether the vehicle actually
  // moved snapped that employee's x/z back to the stationary vehicle's
  // position on every single tick, cancelling out their own
  // tickEmployeeMovement step before it ever accumulated (#922 regression —
  // buildings/holes/hauls stalled indefinitely whenever a driver had a
  // second, on-foot task queued against a not-yet-dispatched vehicle).
  const wasDriving = tickVehicleMovement(state, vehicle, emitter);
  if (wasDriving) syncDriverPosition(state, vehicle);
}

/**
 * Actual movement logic for tickVehicle, split out so tickVehicle can wrap it
 * with a syncDriverPosition call regardless of which internal branch/early-
 * return fired, as long as the vehicle was actually driving this tick (#922).
 * Returns whether the vehicle was actually driving (canTickVehicle passed) —
 * tickVehicle uses this instead of re-checking canTickVehicle itself.
 */
function tickVehicleMovement(state: GameState, vehicle: Vehicle, emitter?: EventEmitter): boolean {
  if (!canTickVehicle(vehicle)) return false;

  if (vehicle.x === vehicle.targetX && vehicle.z === vehicle.targetZ) {
    setVehicleIdle(vehicle);
    return true;
  }

  if (state.navGrid) {
    tickVehicleOnNavGrid(state, vehicle, emitter);
  } else {
    tickVehicleDirectLine(state, vehicle);
  }
  return true;
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
    navGrid: state.navGrid,
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
  //
  // driverId === null blocks unconditionally, on both the NavGrid and
  // direct-line branches, regardless of task/state (#947): a vehicle only
  // ever advances on tick with someone aboard. ArrivalGate.ts's
  // resolveBoarding deliberately leaves task alone until a driver boards, so
  // every existing caller that sets task='moving' already has driverId set
  // first — this closes the class of bug where a driverless vehicle (e.g.
  // Zone.ts's clearZone, before this fix) drove itself.
  return vehicle.driverId !== null && vehicle.task === 'moving' &&
    (vehicle.state === 'idle' || vehicle.state === 'moving' || vehicle.state === 'waiting' || vehicle.state === 'working');
}

export function setVehicleIdle(vehicle: Vehicle): void {
  vehicle.task = 'idle';
  vehicle.state = 'idle';
  vehicle.waitingTicks = 0;
}

export function isCellOccupiedByOtherVehicle(state: GameState, vehicle: Vehicle, x: number, z: number): boolean {
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

/**
 * Keeps a driven employee's logical x/z glued to their vehicle's, every tick
 * the vehicle moves — no-op while `vehicle.driverId` is null. Called
 * unconditionally from `tickVehicle` itself, after its internal movement step
 * (`tickVehicleMovement`, covering both the NavGrid and direct-line steppers)
 * returns, so the driver never renders or navigates from the cell they
 * boarded at regardless of which branch moved the vehicle (#922).
 */
export function syncDriverPosition(state: GameState, vehicle: Vehicle): void {
  if (vehicle.driverId === null) return;
  const driver = state.employees.employees.find(emp => emp.id === vehicle.driverId);
  if (!driver) return;
  driver.x = vehicle.x;
  driver.z = vehicle.z;
}

// ── Employee movement ──

export interface EmployeeMovementResult {
  /** Employee IDs that advanced position this tick. */
  moved: number[];
  /** Employee IDs that reached destinationX/destinationZ this tick. */
  arrived: number[];
  /** Employee IDs that newly entered the stuck state this tick. */
  stuck: number[];
  /** Employee IDs whose claim was released back to the pending-action pool this tick because isMoveStuck sustained for MOVE_STUCK_ABANDON_TICKS consecutive ticks (#938). "Released" means genuinely open-pool — targetEmployeeId cleared/pool-visible, claimable by any qualified employee, not just re-queued to this same one (interruptActiveAction's forceOpenPool option). */
  abandoned: Array<{ employeeId: number; actionId: number | null }>;
}

/**
 * Advance every alive employee with a destination (set by tickEmployees on
 * claim, or by the rest self-claim paths in tickCollapse/tickNeedRestoration/
 * forceShiftRestIfNeeded, now split between NeedRestoration.ts and ForceShiftRest.ts) one tick's worth of movement
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
  const result: EmployeeMovementResult = { moved: [], arrived: [], stuck: [], abandoned: [] };

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
      navGrid: state.navGrid,
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

        // Sustained-stuck release (#938): a destination that has become
        // permanently unreachable (e.g. boxed in by a building placed after
        // the walk was claimed) otherwise pins isMoveStuck true and
        // moveConsecutiveFailures growing forever, with the employee's claim
        // never released back to the pool for another employee to pick up.
        // interruptActiveAction handles both the vehicle-gated case
        // (actionId names a real PendingAction) and the manual `vehicle
        // driver` boarding case (actionId null, no underlying PendingAction)
        // — see its own doc comment (TaskCancellation.ts).
        //
        // forceOpenPool: true — by the time 30 consecutive ticks have failed
        // to move this employee, the destination is a confirmed, sustained
        // impasse, not a transient one. interruptActiveAction's default
        // walk-only pin (which re-targets a mid-walk claim at the SAME
        // employee, for a caller that expects the destination might still
        // resolve) would otherwise hand the action straight back to this
        // employee via claimActionsTargetedAtEmployee next tick, who walks
        // back into the same unreachable spot and re-abandons ~30 ticks
        // later — an infinite cycle on a roster with no closer qualified
        // employee to trigger the softer release path.
        if (emp.moveConsecutiveFailures >= MOVE_STUCK_ABANDON_TICKS) {
          const actionId = emp.activeActionId;
          interruptActiveAction(state, emp, actionId, { forceOpenPool: true });
          result.abandoned.push({ employeeId: emp.id, actionId });
          emitter?.emit('agent:action_abandoned', { employeeId: emp.id, actionId });
        }
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
