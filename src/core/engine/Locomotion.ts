// BlastSimulator2026 — Locomotion (#1089)
// The only mover: walks every alive employee's current itinerary leg (or, for
// an employee with no itinerary, the legacy destinationX/Z single foot leg)
// one tick's worth of movement, and — for a mounted employee — writes their
// vehicle's x/z from theirs. That write is the only place a vehicle's
// position ever changes. Replaces tickVehicle + tickEmployeeMovement
// (EntityMovementTick.ts) and VehicleOccupancyReroute.ts, whose reroute/
// escalation logic is absorbed below.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { Employee } from '../entities/Employee.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { getVehicleDefByTier } from '../entities/Vehicle.js';
import type { Leg } from './Itinerary.js';
import { findPath, type PathResult } from '../nav/Pathfinding.js';
import { advanceAlongPath } from '../nav/AgentAdvance.js';
import {
  AGENT_WALK_SPEED,
  STUCK_MORALE_PENALTY,
  MOVE_STUCK_ABANDON_TICKS,
  VEHICLE_OCCUPANCY_REROUTE_THRESHOLD,
  VEHICLE_ROLE_ARRIVAL_TASK,
} from '../config/balance.js';
import { isMounted, mountedVehicleId } from '../entities/EmployeeLocomotion.js';
import { board, alight } from './Mount.js';
import { isDestinationOccupied, updateVehicleCellOccupancy, tickVehicleTaskState } from './EntityMovementTick.js';
import { interruptActiveAction } from './TaskDispatch.js';
import { startVehicleGatedFragmentWork } from '../economy/FragmentTaskLifecycle.js';
import { moveTo, syncPendingDriverVehicleId } from './MoveTo.js';
import { dismountVehicleDriver } from './VehicleReservation.js';

/** Per-tick report, mirrors the old EmployeeMovementResult shape TickPipeline/console already consume. */
interface LocomotionResult {
  moved: number[];
  arrived: number[];
  stuck: number[];
  abandoned: Array<{ employeeId: number; actionId: number | null }>;
}

/**
 * The only mover. Walks every alive employee's current itinerary leg (or, for
 * an employee with no itinerary, the legacy destinationX/Z single foot leg)
 * one tick's worth of movement, and — for a mounted employee — writes their
 * vehicle's x/z from theirs. The only place a vehicle's position ever changes.
 */
export function tickLocomotion(state: GameState, emitter?: EventEmitter): LocomotionResult {
  const result: LocomotionResult = { moved: [], arrived: [], stuck: [], abandoned: [] };

  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;

    if (emp.itinerary !== null) {
      advanceItinerary(state, emp, result, emitter);
    } else if (emp.destinationX !== null && emp.destinationZ !== null) {
      advanceLegacyFootWalk(state, emp, result, emitter);
    }
  }

  return result;
}

/**
 * Advance a single already-boarded vehicle's driver toward (targetX, targetZ)
 * by one tick, independent of any itinerary — used by HaulingTask.ts's
 * to_depot phase and FragmentTaskLifecycle.ts's driveTowardFragment for their
 * own ad hoc phase-driving. Writes vehicle.x/z from the driver's own advance.
 * No-op (returns arrived:false) when the vehicle has no occupant.
 */
export function driveVehicleTowardTarget(
  state: GameState,
  vehicle: Vehicle,
  targetX: number,
  targetZ: number,
  emitter?: EventEmitter,
): { arrived: boolean } {
  const driverId = vehicle.occupantIds[0];
  if (driverId === undefined) return { arrived: false };
  const driver = state.employees.employees.find(e => e.id === driverId);
  if (!driver) return { arrived: false };

  const leg: Leg = {
    mode: 'drive',
    vehicleId: vehicle.id,
    destX: targetX,
    destZ: targetZ,
    arrival: 'exact',
    onArrive: { kind: 'none' },
    estTicks: 0,
  };

  if (isLegArrived(driver.x, driver.z, leg)) return { arrived: true };

  const outcome = advanceLeg(state, driver, leg, { moved: [], arrived: [], stuck: [], abandoned: [] }, emitter);
  if (outcome === 'aborted') return { arrived: false };
  return { arrived: isLegArrived(driver.x, driver.z, leg) };
}

// ── Legacy on-foot movement (destinationX/Z, no itinerary) ──

/**
 * Advance an employee walking toward destinationX/destinationZ directly —
 * RestActionHelpers.ts's beginRestTravel and Zone.ts's foot-evacuee branch both
 * keep writing these fields rather than building an itinerary (gameplay-
 * vehicle-fleet's phase 3b scope). Unchanged from the old tickEmployeeMovement.
 */
function advanceLegacyFootWalk(state: GameState, emp: Employee, result: LocomotionResult, emitter?: EventEmitter): void {
  const destX = emp.destinationX!;
  const destZ = emp.destinationZ!;

  if (emp.x === destX && emp.z === destZ) {
    emp.destinationX = null;
    emp.destinationZ = null;
    return;
  }

  const path = state.navGrid
    ? findPath(state.navGrid, {
        agentId: emp.id, fromX: emp.x, fromZ: emp.z, toX: destX, toZ: destZ,
        avoidVehicles: !isDestinationOccupied(state, destX, destZ),
      })
    : { found: true, waypoints: [{ x: emp.x, z: emp.z }, { x: destX, z: destZ }] };

  const outcome = advanceAlongPath({
    x: emp.x, z: emp.z, walkSpeed: AGENT_WALK_SPEED,
    destinationX: destX, destinationZ: destZ,
    consecutiveFailures: emp.moveConsecutiveFailures, isStuck: emp.isMoveStuck,
    path, navGrid: state.navGrid,
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

      if (emp.moveConsecutiveFailures >= MOVE_STUCK_ABANDON_TICKS) {
        const actionId = emp.activeActionId;
        interruptActiveAction(state, emp, actionId, { forceOpenPool: true });
        result.abandoned.push({ employeeId: emp.id, actionId });
        emitter?.emit('agent:action_abandoned', { employeeId: emp.id, actionId });
      }
    }
    return;
  }

  emp.x = outcome.x;
  emp.z = outcome.z;
  result.moved.push(emp.id);

  if (outcome.isPathComplete) {
    emp.x = destX;
    emp.z = destZ;
    emp.destinationX = null;
    emp.destinationZ = null;
    result.arrived.push(emp.id);
  }
}

// ── Itinerary-driven movement ──

/** Whether (x, z) satisfies `leg`'s own arrival test — exact-cell for most legs, within one tile for a board leg. */
function isLegArrived(x: number, z: number, leg: Leg): boolean {
  if (leg.arrival === 'adjacent') {
    return Math.max(Math.abs(x - leg.destX), Math.abs(z - leg.destZ)) <= 1;
  }
  return x === leg.destX && z === leg.destZ;
}

function clearItineraryOnFailure(emp: Employee): void {
  emp.itinerary = null;
  syncPendingDriverVehicleId(emp);
}

/**
 * Walk `emp`'s current itinerary one tick's worth: advances the current leg,
 * and — the instant it arrives — applies its arrival step and continues
 * straight into the next leg (a zero-length leg, e.g. an already-mounted
 * continuity leg, applies its own arrival step the same tick it becomes
 * current, never idling a tick waiting for a movement tick that would never
 * fire). Stops for the tick on a blocked leg, a leg that only partially
 * advanced, or a leg/itinerary that failed and was cleared.
 */
function advanceItinerary(state: GameState, emp: Employee, result: LocomotionResult, emitter?: EventEmitter): void {
  let moved = false;

  for (;;) {
    const itinerary = emp.itinerary;
    if (itinerary === null) break;
    if (itinerary.legs.length === 0) {
      // I6: an itinerary must never sit empty instead of being cleared to
      // null — defensive cleanup, should not occur if callers stay correct.
      clearItineraryOnFailure(emp);
      break;
    }

    const leg = itinerary.legs[0]!;

    if (!isLegArrived(emp.x, emp.z, leg)) {
      const outcome = advanceLeg(state, emp, leg, result, emitter);
      if (outcome === 'moved') moved = true;
      if (outcome === 'aborted') {
        clearItineraryOnFailure(emp);
        break;
      }
      if (outcome === 'blocked') break;
      if (!isLegArrived(emp.x, emp.z, leg)) break;
    }

    const ok = applyArrivalStep(state, emp, leg, emitter);

    // A board arrival step's post-board handling (evacuation redrive,
    // fragment-work handoff) may itself have installed a brand-new
    // itinerary, or cleared this one — either way it supersedes what this
    // loop was walking, so stop here rather than mutate an object
    // emp.itinerary no longer even points to.
    if (emp.itinerary !== itinerary) break;

    if (!ok) {
      clearItineraryOnFailure(emp);
      break;
    }

    itinerary.legs.shift();
    syncPendingDriverVehicleId(emp);
    if (itinerary.legs.length === 0) {
      emp.itinerary = null;
      result.arrived.push(emp.id);
      break;
    }
    // Continue the loop for the next leg — may complete this same tick.
  }

  if (moved) result.moved.push(emp.id);
}

type LegMoveOutcome = 'moved' | 'blocked' | 'aborted';

/** Advance `leg` by one tick's worth of movement (foot at AGENT_WALK_SPEED, or drive at the vehicle's tiered speed). Mutates emp.x/z and, for a drive leg, the vehicle's x/z too. */
function advanceLeg(state: GameState, emp: Employee, leg: Leg, result: LocomotionResult, emitter?: EventEmitter): LegMoveOutcome {
  const isDrive = leg.mode === 'drive';
  let vehicle: Vehicle | undefined;

  if (isDrive) {
    vehicle = state.vehicles.vehicles.find(v => v.id === leg.vehicleId);
    // The leg's vehicle no longer resolves, or someone else now occupies it
    // (reassigned out from under this employee) — fail the leg gracefully.
    if (!vehicle || vehicle.occupantIds[0] !== emp.id) return 'aborted';
  }

  const speed = isDrive ? getVehicleDefByTier(vehicle!.type, vehicle!.tier).speed : AGENT_WALK_SPEED;
  // Drive legs ignore NavCell.vehicleOccupied entirely (a vehicle must be
  // able to drive onto another vehicle's or a fragment's cell to interact
  // with it) and instead check live vehicle-vs-vehicle occupancy on the
  // immediate next step below — mirrors the old tickVehicleOnNavGrid. Foot
  // legs avoid every occupied cell except when the destination itself is
  // occupied (boarding a vehicle sitting there, or charging a hole a
  // drill_rig is still parked on) — mirrors the old tickEmployeeMovement.
  const avoidVehicles = isDrive ? false : !isDestinationOccupied(state, leg.destX, leg.destZ);

  const path: PathResult | { found: boolean; waypoints: Array<{ x: number; z: number }> } = state.navGrid
    ? findPath(state.navGrid, { agentId: emp.id, fromX: emp.x, fromZ: emp.z, toX: leg.destX, toZ: leg.destZ, avoidVehicles })
    : { found: true, waypoints: [{ x: emp.x, z: emp.z }, { x: leg.destX, z: leg.destZ }] };

  if (isDrive && state.navGrid && path.found) {
    const nextStep = nextGridStep(emp.x, emp.z, path.waypoints);
    if (nextStep && isOccupiedByOtherVehicle(state, vehicle!.id, nextStep.x, nextStep.z)) {
      return handleOccupancyBlock(state, emp, vehicle!, leg, emitter);
    }
  }

  const outcome = advanceAlongPath({
    x: emp.x, z: emp.z, walkSpeed: speed,
    destinationX: leg.destX, destinationZ: leg.destZ,
    consecutiveFailures: emp.moveConsecutiveFailures, isStuck: emp.isMoveStuck,
    path, navGrid: state.navGrid,
  });

  emp.moveConsecutiveFailures = outcome.consecutiveFailures;
  emp.isMoveStuck = outcome.isStuck;
  if (isDrive) {
    vehicle!.moveConsecutiveFailures = outcome.consecutiveFailures;
    vehicle!.isMoveStuck = outcome.isStuck;
  }

  if (!outcome.pathFound) {
    if (outcome.becameStuck) emitter?.emit('agent:stuck', { employeeId: emp.id });
    emp.morale = Math.max(0, emp.morale - STUCK_MORALE_PENALTY);

    if (emp.moveConsecutiveFailures >= MOVE_STUCK_ABANDON_TICKS) {
      const actionId = emp.activeActionId;
      interruptActiveAction(state, emp, actionId, { forceOpenPool: true });
      // #986: interruptActiveAction(..., actionId: null, ...) is a no-op —
      // nothing to release via an action — so a vehicle driven with no
      // PendingAction at all (a manual `vehicle driver`/`vehicle haul`
      // console command) would otherwise never dismount here and stay stuck
      // forever. Mirrors the pre-itinerary tickVehicleOnNavGrid's own
      // explicit, unconditional dismountVehicleDriver call on this same
      // abandon path (EntityMovementTick.ts, deleted) — releaseVehicleReservation
      // already calls this as part of releasing a real action, so this is a
      // harmless no-op (past its own idempotent abort) in that case. Also
      // clears the now-invalid drive leg immediately (I7: a drive leg's
      // employee must be mounted in that leg's vehicle) — the ordinary
      // aborted-leg self-heal (advanceLeg's own occupant-mismatch check,
      // above) only runs on the NEXT tickLocomotion pass, one tick too late
      // to cover this employee's own itinerary within the very call that
      // just alighted them.
      if (isDrive) {
        dismountVehicleDriver(state, vehicle!, emitter);
        clearItineraryOnFailure(emp);
      }
      result.abandoned.push({ employeeId: emp.id, actionId });
      emitter?.emit('agent:action_abandoned', { employeeId: emp.id, actionId });
      // #986: the released vehicle's own stuck mirror must reset too — left
      // set, a freshly idle vehicle re-accumulates from a stale
      // moveConsecutiveFailures/isMoveStuck the instant its next driver's own
      // drive leg starts touching these same fields, hitting this same
      // abandon branch again almost immediately instead of getting the full
      // MOVE_STUCK_ABANDON_TICKS a genuinely new drive is owed — mirrors the
      // pre-itinerary tickVehicleOnNavGrid's own identical reset right after
      // its abandon release (EntityMovementTick.ts, deleted).
      if (isDrive) {
        vehicle!.moveConsecutiveFailures = 0;
        vehicle!.isMoveStuck = false;
      }
    }
    return 'blocked';
  }

  emp.vehicleWaitingTicks = 0;
  if (isDrive) vehicle!.waitingTicks = 0;

  emp.x = outcome.x;
  emp.z = outcome.z;
  if (isDrive) writeVehiclePosition(state, vehicle!, outcome.x, outcome.z, leg);

  return 'moved';
}

/**
 * Handles a drive leg whose next grid step is occupied by another live
 * vehicle: waits, and once `emp.vehicleWaitingTicks` reaches
 * VEHICLE_OCCUPANCY_REROUTE_THRESHOLD, attempts a one-shot reroute avoiding
 * every other vehicle's current cell. A successful reroute applies its
 * outcome immediately (same tick); a failed one falls back to relocating
 * whatever blocks the destination cell itself (#689, restored below) before
 * finally escalating the employee (not the vehicle) to stuck, once, on the
 * rising edge. Absorbed from the old VehicleOccupancyReroute.ts.
 */
function handleOccupancyBlock(state: GameState, emp: Employee, vehicle: Vehicle, leg: Leg, emitter?: EventEmitter): LegMoveOutcome {
  const wasStuckBefore = emp.isMoveStuck;
  emp.vehicleWaitingTicks++;
  vehicle.waitingTicks = emp.vehicleWaitingTicks;
  vehicle.state = 'waiting';

  if (emp.vehicleWaitingTicks < VEHICLE_OCCUPANCY_REROUTE_THRESHOLD) return 'blocked';

  const reroute = findPathAvoidingOtherVehicles(state, emp, vehicle, leg.destX, leg.destZ);
  if (reroute.found) {
    const outcome = advanceAlongPath({
      x: emp.x, z: emp.z,
      walkSpeed: getVehicleDefByTier(vehicle.type, vehicle.tier).speed,
      destinationX: leg.destX, destinationZ: leg.destZ,
      consecutiveFailures: 0, isStuck: false,
      path: reroute,
    });

    emp.moveConsecutiveFailures = outcome.consecutiveFailures;
    emp.isMoveStuck = false;
    emp.vehicleWaitingTicks = 0;
    vehicle.moveConsecutiveFailures = outcome.consecutiveFailures;
    vehicle.isMoveStuck = false;
    vehicle.waitingTicks = 0;

    // The employee's own x/z must move too (I2) — a reroute that only wrote
    // the vehicle's position left the employee frozen at the pre-reroute
    // cell forever: findPathAvoidingOtherVehicles reads its FROM point off
    // emp.x/z, so a stale employee position recomputed the identical
    // "successful" reroute to the identical first waypoint every subsequent
    // tick, never progressing (confirmed live: the tutorial's own box-cut
    // ramp order stalled a rock_digger permanently behind an idle drill_rig
    // this exact way).
    emp.x = outcome.x;
    emp.z = outcome.z;
    writeVehiclePosition(state, vehicle, outcome.x, outcome.z, leg);
    return 'moved';
  }

  // #1103: every route avoiding live vehicles is blocked, including the
  // destination cell itself — restore #689's blocker-relocation fallback,
  // dropped when this function was absorbed from the old
  // VehicleOccupancyReroute.ts (#1089). A driverless, unreserved, idle
  // vehicle squatting exactly on this leg's destination (e.g. a rig whose
  // driver was reassigned mid-drilling by Mount's Chebyshev-radius boarding)
  // has no task of its own to interrupt, so it is simply relocated to the
  // nearest free cell; a driven one relocates by really driving itself clear
  // via moveTo. Confirmed live: level1-lose-ecology.json's own H44 stalled
  // at holeCount 48/49 forever without this — an idle drill_rig from a
  // finished crew parked squarely on the one hole still left to drill.
  if (relocateDestinationBlocker(state, leg.destX, leg.destZ, vehicle.id)) return 'blocked';

  emp.isMoveStuck = true;
  vehicle.isMoveStuck = true;
  if (!wasStuckBefore) emitter?.emit('vehicle:stuck', { vehicleId: vehicle.id });
  return 'blocked';
}

/**
 * Restores #689's deadlock-clearing fallback for the itinerary mover: when
 * no route to (destX, destZ) avoids every other live vehicle, and that is
 * because another vehicle sits exactly ON the destination cell itself,
 * relocate that blocker instead of leaving the requester stuck forever.
 * Returns true when a relocation was attempted (already relocating, or just
 * started one) — the caller stays 'blocked' for this tick either way, and
 * the escalation-to-stuck fallback below only fires when this returns false
 * (no blocker, or one that cannot be relocated at all).
 */
function relocateDestinationBlocker(state: GameState, destX: number, destZ: number, requesterVehicleId: number): boolean {
  const blocker = state.vehicles.vehicles.find(v => v.id !== requesterVehicleId && v.x === destX && v.z === destZ);
  if (!blocker) return false;

  // Already relocating — this trigger or a prior tick's — give it time to
  // clear rather than pile on a second relocation order.
  if (blocker.state === 'moving') return true;
  if (blocker.task !== 'idle' || blocker.reservedForActionId !== null) return false;

  const freeCell = findNearestFreeCellForVehicle(state, blocker);
  if (!freeCell) return false;

  if (blocker.driverId !== null) {
    moveTo(state, blocker.driverId, { x: freeCell.x, z: freeCell.z });
  } else {
    relocateDriverlessVehicle(state, blocker, freeCell.x, freeCell.z);
  }
  return true;
}

/**
 * Direct repositioning for a driverless idle blocker (#689/#1087 follow-up):
 * no driver exists to drive it clear through the ordinary itinerary
 * machinery, and none is needed — an unreserved, driverless vehicle has no
 * task of its own in flight to interrupt, so it is simply placed on (x, z)
 * outright. Keeps NavCell.vehicleOccupied in sync via
 * updateVehicleCellOccupancy so foot/vehicle pathfinding immediately sees
 * the old cell as free and the new one as occupied.
 */
function relocateDriverlessVehicle(state: GameState, blocker: Vehicle, x: number, z: number): void {
  const prevX = Math.floor(blocker.x);
  const prevZ = Math.floor(blocker.z);
  const wasStationary = blocker.state !== 'moving';

  blocker.x = x;
  blocker.z = z;

  updateVehicleCellOccupancy(state, blocker, wasStationary, prevX, prevZ);
}

/**
 * Nearest walkable, unoccupied NavGrid cell adjacent to `blocker`'s current
 * position (#689) — an expanding ring search (immediate neighbours first,
 * then two cells out) so a blocker wedged against another obstacle still
 * finds somewhere to go. Returns null when nothing nearby qualifies.
 */
function findNearestFreeCellForVehicle(state: GameState, blocker: Vehicle): { x: number; z: number } | null {
  const grid = state.navGrid;
  if (!grid) return null;

  const bx = Math.floor(blocker.x);
  const bz = Math.floor(blocker.z);
  let best: { x: number; z: number } | null = null;
  let bestDistSq = Infinity;

  for (let radius = 1; radius <= 2; radius++) {
    for (let x = bx - radius; x <= bx + radius; x++) {
      for (let z = bz - radius; z <= bz + radius; z++) {
        if (x === bx && z === bz) continue;
        const onRing = Math.max(Math.abs(x - bx), Math.abs(z - bz)) === radius;
        if (!onRing) continue;

        const cell = grid.cellAt(x, z);
        if (!cell || cell.type === 'blocked' || cell.type === 'void') continue;
        if (isOccupiedByOtherVehicle(state, blocker.id, x, z)) continue;

        const distSq = (x - bx) ** 2 + (z - bz) ** 2;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          best = { x, z };
        }
      }
    }
    if (best) return best;
  }

  return best;
}

/** Writes a driving employee's advance onto their vehicle — the only place a vehicle's x/z ever changes. */
function writeVehiclePosition(state: GameState, vehicle: Vehicle, x: number, z: number, leg: Leg): void {
  const wasStationary = vehicle.state !== 'moving';
  const prevX = Math.round(vehicle.x);
  const prevZ = Math.round(vehicle.z);

  vehicle.x = x;
  vehicle.z = z;
  vehicle.targetX = leg.destX;
  vehicle.targetZ = leg.destZ;
  vehicle.state = 'moving';
  vehicle.task = 'moving';

  updateVehicleCellOccupancy(state, vehicle, wasStationary, prevX, prevZ);
}

/** The immediate next grid cell along a found path — the one occupancy is checked against. Mirrors the old nextGridStep. */
function nextGridStep(x: number, z: number, waypoints: Array<{ x: number; z: number }>): { x: number; z: number } | null {
  if (waypoints.length === 0) return null;
  const first = waypoints[0]!;
  const atFirst = Math.floor(x) === first.x && Math.floor(z) === first.z;
  if (atFirst && waypoints.length > 1) return waypoints[1]!;
  return first;
}

function isOccupiedByOtherVehicle(state: GameState, selfVehicleId: number, x: number, z: number): boolean {
  return state.vehicles.vehicles.some(v => v.id !== selfVehicleId && v.x === x && v.z === z);
}

/**
 * Re-runs findPath with every OTHER live vehicle's current cell temporarily
 * marked vehicleOccupied, so avoidVehicles:true actually routes around them.
 * Marks are reverted before returning — no lasting mutation to state.navGrid.
 * Mirrors the old VehicleOccupancyReroute.ts's findPathAvoidingOtherVehicles.
 */
function findPathAvoidingOtherVehicles(state: GameState, emp: Employee, vehicle: Vehicle, destX: number, destZ: number): PathResult {
  const grid = state.navGrid!;
  const marked: Array<{ x: number; z: number; prev: boolean }> = [];

  try {
    for (const other of state.vehicles.vehicles) {
      if (other.id === vehicle.id) continue;
      const cx = Math.floor(other.x);
      const cz = Math.floor(other.z);
      const cell = grid.cellAt(cx, cz);
      if (!cell || cell.vehicleOccupied) continue;
      marked.push({ x: cx, z: cz, prev: cell.vehicleOccupied });
      cell.vehicleOccupied = true;
    }

    return findPath(grid, { agentId: emp.id, fromX: emp.x, fromZ: emp.z, toX: destX, toZ: destZ, avoidVehicles: true });
  } finally {
    for (const mark of marked) {
      const cell = grid.cellAt(mark.x, mark.z);
      if (cell) cell.vehicleOccupied = mark.prev;
    }
  }
}

// ── Arrival steps ──

/** Applies `leg`'s arrival step. Returns false when the step fails (vehicle gone/taken) — the caller clears the itinerary and leaves the employee on foot where they stand. */
function applyArrivalStep(state: GameState, emp: Employee, leg: Leg, emitter?: EventEmitter): boolean {
  // A completed drive leg's vehicle always snaps back to idle first — mirrors
  // the pre-itinerary tickVehicleOnNavGrid's own unconditional arrival snap
  // (EntityMovementTick.ts, deleted: "if (vehicle.x === vehicle.targetX && ...)
  // setVehicleIdle(vehicle)"), which ran for every drive regardless of what
  // it was for. Only THEN, when this drive was actually for a reserved
  // vehicle-gated PendingAction (reservedForActionId set), does it take on
  // its role's arrival task as a display mirror (fuel/HUD upkeep) instead —
  // mirrors the old vehicle-drive loop's own identical override
  // (ArrivalGate.ts, scoped to `vehicle.reservedForActionId !== null`, see
  // that file's own #550 header). A plain reposition drive (moveTo(x,z) with
  // no reservation — an evacuation-clear, or a manual `vehicle driver`/test
  // drive) never had a task of its own to arrive INTO, and settles on idle.
  if (leg.mode === 'drive' && leg.vehicleId !== null) {
    const drivenVehicle = state.vehicles.vehicles.find(v => v.id === leg.vehicleId);
    if (drivenVehicle) {
      drivenVehicle.task = 'idle';
      drivenVehicle.state = 'idle';
      drivenVehicle.waitingTicks = 0;
      if (drivenVehicle.reservedForActionId !== null) {
        drivenVehicle.task = VEHICLE_ROLE_ARRIVAL_TASK[drivenVehicle.type];
        tickVehicleTaskState(drivenVehicle);
      }
    }
  }

  const step = leg.onArrive;
  if (step.kind === 'none' || step.kind === 'effect') return true;

  if (step.kind === 'board') {
    const vehicle = state.vehicles.vehicles.find(v => v.id === step.vehicleId);
    if (!vehicle) return false;

    const alreadyThere = isMounted(emp.locomotion) && mountedVehicleId(emp.locomotion) === vehicle.id;
    if (!alreadyThere) {
      const boarded = board(state, vehicle.id, emp.id, emitter);
      if (!boarded.success) {
        // #1042: a stale evacuation marker on this vehicle must not confuse
        // whoever drives it next — the driver who actually took it either
        // isn't evacuating at all, or staged their own marker via clearZone
        // already. Mirrors the old ArrivalGate.resolveBoarding's identical
        // cleanup on every cancelled-boarding path.
        vehicle.pendingEvacuationDestination = null;
        return false;
      }
    }

    handlePostBoardIntent(state, emp, vehicle);
    return true;
  }

  // step.kind === 'alight'
  const vehicleId = isMounted(emp.locomotion) ? mountedVehicleId(emp.locomotion) : null;
  if (vehicleId === null) return true; // already on foot — nothing to undo
  return alight(state, vehicleId, emitter).success;
}

/**
 * Whatever was staged on `vehicle` before this exact board resolved — a
 * vehicle-gated action's own haul/break work (#552), or an evacuation drive
 * clear (#1042) — starts now, the moment the driver is actually seated.
 * Absorbed from the old ArrivalGate.resolveBoarding, which lived right next
 * to its own `board()` call for the same reason boarding itself moved here
 * (#1089): both are "what a board resolves into", not two separate concerns.
 */
function handlePostBoardIntent(state: GameState, emp: Employee, vehicle: Vehicle): void {
  if (vehicle.reservedForActionId !== null) {
    const action = state.pendingActions.find(a => a.id === vehicle.reservedForActionId);
    if (action) {
      const started = startVehicleGatedFragmentWork(state, vehicle, action);
      if (started === true) {
        // Phase machinery (HaulingTask.ts/BoulderBreaking.ts) now owns
        // driving this vehicle end to end — the itinerary's own remaining
        // drive leg would otherwise fight it for the same vehicle's x/z.
        emp.itinerary = null;
        syncPendingDriverVehicleId(emp);
      } else if (started === false) {
        // Fragment/depot/eligibility changed between claim and boarding
        // (fragment picked clean, no active warehouse, etc.) — release the
        // action back to the pool instead of leaving the vehicle boarded
        // with nothing to do; keepVehicleDriver leaves `emp` seated, since
        // they just boarded this exact vehicle moments ago in this same
        // tick — dismounting them now would only force a needless
        // walk-back-and-reboard the instant the situation clears.
        interruptActiveAction(state, emp, action.id, { keepVehicleDriver: true });
      }
      // started === null: not a fragment-gated action — the itinerary's own
      // already-queued drive leg drives the rest of the way.
    }
    return;
  }

  if (vehicle.pendingEvacuationDestination !== null) {
    // Boarded to drive a vehicle clear of an evacuating zone (#1042) rather
    // than for a vehicle-gated action — no reservation to hand off to.
    // moveTo's own implicit continuity (via the employee's just-established
    // mount) plans straight to a drive leg, no redundant foot/board leg.
    const dest = vehicle.pendingEvacuationDestination;
    moveTo(state, emp.id, { x: dest.x, z: dest.z });
  }
}
