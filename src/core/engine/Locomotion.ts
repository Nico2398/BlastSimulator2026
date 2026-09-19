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
import { getVehicleDefByTier, vehicleDriverId, isVehicleCurrentlyDriving, getVehicleReservation } from '../entities/Vehicle.js';
import type { Leg } from './Itinerary.js';
import { findPath, type PathResult } from '../nav/Pathfinding.js';
import { advanceAlongPath, NULL_ROUTE_COMMITMENT, type RouteCommitment } from '../nav/AgentAdvance.js';
import {
  AGENT_WALK_SPEED,
  STUCK_MORALE_PENALTY,
  MOVE_STUCK_ABANDON_TICKS,
  VEHICLE_OCCUPANCY_REROUTE_THRESHOLD,
} from '../config/balance.js';
import { isMounted, mountedVehicleId } from '../entities/EmployeeLocomotion.js';
import { board, alight } from './Mount.js';
import { isDestinationOccupied, updateVehicleCellOccupancy } from './EntityMovementTick.js';
import { interruptActiveAction } from './TaskDispatch.js';
import { applyArrivalEffect } from './ArrivalEffects.js';
import { moveTo, syncPendingDriverVehicleId } from './MoveTo.js';
import { dismountVehicleDriver, releaseVehicleReservation } from './VehicleReservation.js';

/** Reads `emp`'s carried route-commitment (#1129) into the shape `advanceAlongPath` takes. */
function readCommitted(emp: Employee): RouteCommitment {
  return {
    waypointX: emp.committedWaypointX ?? null,
    waypointZ: emp.committedWaypointZ ?? null,
    destX: emp.committedDestX ?? null,
    destZ: emp.committedDestZ ?? null,
    remainingCost: emp.committedRemainingCost ?? null,
    fromX: emp.committedFromX ?? null,
    fromZ: emp.committedFromZ ?? null,
    originX: emp.committedOriginX ?? null,
    originZ: emp.committedOriginZ ?? null,
  };
}

/** Writes an `advanceAlongPath` outcome's route-commitment (#1129) back onto `emp` for next tick. */
function writeCommitted(emp: Employee, committed: RouteCommitment): void {
  emp.committedWaypointX = committed.waypointX;
  emp.committedWaypointZ = committed.waypointZ;
  emp.committedDestX = committed.destX;
  emp.committedDestZ = committed.destZ;
  emp.committedRemainingCost = committed.remainingCost;
  emp.committedFromX = committed.fromX ?? null;
  emp.committedFromZ = committed.fromZ ?? null;
  emp.committedOriginX = committed.originX ?? null;
  emp.committedOriginZ = committed.originZ ?? null;
}

/**
 * True while `emp`'s drive leg is still detouring around a parked vehicle
 * (#1166) — i.e. a blocker cell was recorded and some other vehicle is still
 * sitting on it. Clears the latch and returns false otherwise, so ordinary
 * routing resumes the moment the chokepoint frees up.
 *
 * The latch is what makes a reroute survive past the tick it was computed on.
 * `advanceLeg` repaths from scratch every tick with `avoidVehicles: false`
 * (a drive leg must be able to drive onto another vehicle's cell to interact
 * with it), so the unconstrained shortest route heads straight back at the
 * blocker as soon as the detour's first step is taken. Where the way around
 * is much longer than the way through — a chokepoint, which is what #1151's
 * slope gate turns ordinary relief into — that produces a permanent
 * back-and-forth: block, wait out VEHICLE_OCCUPANCY_REROUTE_THRESHOLD,
 * one step of detour, repath, block again. Nothing escalates it, either:
 * every reroute resets isMoveStuck/moveConsecutiveFailures and the ticks in
 * between are ordinary successful movement, so the stuck-abandon path never
 * fires.
 */
function isDetouringAroundVehicle(state: GameState, emp: Employee, selfVehicleId: number): boolean {
  const x = emp.vehicleDetourX ?? null;
  const z = emp.vehicleDetourZ ?? null;
  if (x === null || z === null) return false;
  if (isOccupiedByOtherVehicle(state, selfVehicleId, x, z)) return true;
  clearVehicleDetour(emp);
  return false;
}

/** Records the cell `emp`'s drive leg is detouring around (#1166) — see `isDetouringAroundVehicle`. */
function markVehicleDetour(emp: Employee, x: number, z: number): void {
  emp.vehicleDetourX = x;
  emp.vehicleDetourZ = z;
}

/** Drops `emp`'s detour latch (#1166): the blocker moved off, or the leg it was recorded for is over. */
function clearVehicleDetour(emp: Employee): void {
  emp.vehicleDetourX = null;
  emp.vehicleDetourZ = null;
}

/** Reads `emp`'s carried move-history shift-register (#1130) into the shape `advanceAlongPath` takes. */
function readMoveHistory(emp: Employee): { moveHistoryX: number | null; moveHistoryZ: number | null } {
  return {
    moveHistoryX: emp.moveHistoryX ?? null,
    moveHistoryZ: emp.moveHistoryZ ?? null,
  };
}

/** Writes an `advanceAlongPath` outcome's move-history fields (#1130) back onto `emp` for next tick. */
function writeMoveHistory(emp: Employee, moveHistoryX: number | null, moveHistoryZ: number | null): void {
  emp.moveHistoryX = moveHistoryX;
  emp.moveHistoryZ = moveHistoryZ;
}

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

  const avoidVehicles = !isDestinationOccupied(state, destX, destZ);

  // Snapped through NavGrid's own (nearest-cell, round-based) convention
  // rather than handed to findPath continuous (#1166): Pathfinding.ts's own
  // clampToGrid floors instead, which can choose a start cell up to a full
  // diagonal away from the agent's true nearest cell — on steep terrain,
  // that phantom floor cell can have locally poor connectivity (neighbours
  // it alone finds climb-illegal) that the agent's real nearest cell does
  // not, producing a needlessly long fresh replan every tick and, combined
  // with a `committed` route already near-optimal, a stable no-progress
  // cycle between the two. `Pathfinding.ts`'s own neighbour-expansion stays
  // untouched; only the request's own start point moves to agree with the
  // rest of the nav stack (`NavGrid.clampX`/`clampZ`, used throughout
  // AgentAdvance.ts) on which cell a continuous position belongs to.
  const fromX = state.navGrid ? state.navGrid.clampX(emp.x) : emp.x;
  const fromZ = state.navGrid ? state.navGrid.clampZ(emp.z) : emp.z;
  const path = state.navGrid
    ? findPath(state.navGrid, {
        agentId: emp.id, fromX, fromZ, toX: destX, toZ: destZ,
        avoidVehicles,
      })
    : { found: true, waypoints: [{ x: emp.x, z: emp.z }, { x: destX, z: destZ }] };

  const outcome = advanceAlongPath({
    x: emp.x, z: emp.z, walkSpeed: AGENT_WALK_SPEED,
    destinationX: destX, destinationZ: destZ,
    consecutiveFailures: emp.moveConsecutiveFailures, isStuck: emp.isMoveStuck,
    path, navGrid: state.navGrid, avoidVehicles,
    committed: readCommitted(emp),
    ...readMoveHistory(emp),
  });

  emp.moveConsecutiveFailures = outcome.consecutiveFailures;
  emp.isMoveStuck = outcome.isStuck;
  writeCommitted(emp, outcome.committed);
  writeMoveHistory(emp, outcome.moveHistoryX, outcome.moveHistoryZ);

  if (!outcome.pathFound || outcome.isStuck) {
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
    if (!outcome.pathFound) return;
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
  clearVehicleDetour(emp);
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
      // advanceLeg itself records emp.id (and, for a drive leg, the
      // vehicle's id) into result.moved whenever the position genuinely
      // advanced this tick — independent of whether the tick also returns
      // 'blocked' via the isStuck-abandon branch below. "Position moved"
      // and "action got abandoned" are independent outcomes of the same
      // tick; do not fold them back into one boolean here.
      const outcome = advanceLeg(state, emp, leg, result, emitter);
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
    // #1166: the detour latch is scoped to the leg that recorded it — the
    // next leg starts from a clean route and finds its own blockers.
    clearVehicleDetour(emp);
    syncPendingDriverVehicleId(emp);
    if (itinerary.legs.length === 0) {
      emp.itinerary = null;
      result.arrived.push(emp.id);
      break;
    }
    // Continue the loop for the next leg — may complete this same tick.
  }
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

  // Snapped through NavGrid's own round-based cell convention rather than
  // handed to findPath continuous — see advanceLegacyFootWalk's identical
  // fix above (#1166) for why.
  const driveFromX = state.navGrid ? state.navGrid.clampX(emp.x) : emp.x;
  const driveFromZ = state.navGrid ? state.navGrid.clampZ(emp.z) : emp.z;

  // #1166: a drive leg part-way around a still-parked blocker keeps following
  // the vehicle-avoiding route it committed to, rather than repathing back
  // through the blocker and stalling again — see isDetouringAroundVehicle.
  // A detour that stops resolving (the way around closed behind it) falls
  // back to ordinary routing, which re-enters handleOccupancyBlock below and
  // reaches its own stuck/relocate escalation from there.
  let detourPath: PathResult | null = null;
  if (isDrive && state.navGrid && isDetouringAroundVehicle(state, emp, vehicle!.id)) {
    const rerouted = findPathAvoidingOtherVehicles(state, emp, vehicle!, leg.destX, leg.destZ);
    if (rerouted.found) detourPath = rerouted;
    else clearVehicleDetour(emp);
  }

  const path: PathResult | { found: boolean; waypoints: Array<{ x: number; z: number }> } = detourPath
    ?? (state.navGrid
      ? findPath(state.navGrid, { agentId: emp.id, fromX: driveFromX, fromZ: driveFromZ, toX: leg.destX, toZ: leg.destZ, avoidVehicles })
      : { found: true, waypoints: [{ x: emp.x, z: emp.z }, { x: leg.destX, z: leg.destZ }] });

  if (isDrive && state.navGrid && path.found) {
    const nextStep = nextGridStep(emp.x, emp.z, path.waypoints);
    if (nextStep && isOccupiedByOtherVehicle(state, vehicle!.id, nextStep.x, nextStep.z)) {
      return handleOccupancyBlock(state, emp, vehicle!, leg, nextStep, result, emitter);
    }
  }

  const outcome = advanceAlongPath({
    x: emp.x, z: emp.z, walkSpeed: speed,
    destinationX: leg.destX, destinationZ: leg.destZ,
    consecutiveFailures: emp.moveConsecutiveFailures, isStuck: emp.isMoveStuck,
    path, navGrid: state.navGrid, avoidVehicles,
    committed: readCommitted(emp),
    ...readMoveHistory(emp),
  });

  emp.moveConsecutiveFailures = outcome.consecutiveFailures;
  emp.isMoveStuck = outcome.isStuck;
  writeCommitted(emp, outcome.committed);
  writeMoveHistory(emp, outcome.moveHistoryX, outcome.moveHistoryZ);

  // Position/waitingTicks only advance on a genuinely found path — a period-2
  // oscillation (outcome.isStuck true, pathFound still true) really did walk
  // this tick, just back to where it stood 2 ticks ago, so this still counts
  // as the entity's real position; only the abandon check below additionally
  // fires on it.
  if (outcome.pathFound) {
    emp.vehicleWaitingTicks = 0;

    emp.x = outcome.x;
    emp.z = outcome.z;
    if (isDrive) writeVehiclePosition(state, vehicle!, outcome.x, outcome.z);

    // Position genuinely advanced this tick — record it regardless of
    // whether the isStuck-abandon branch below also fires (an oscillating
    // tick can be both "moved" and "abandoned" at once; they're independent).
    result.moved.push(emp.id);
    if (isDrive) result.moved.push(vehicle!.id);
  }

  if (!outcome.pathFound || outcome.isStuck) {
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
      // #986/#1138: the stuck mirror lived on the vehicle so a freshly idle
      // vehicle wouldn't re-accumulate a stale count on its next driver — now
      // that isMoveStuck/moveConsecutiveFailures live only on the employee
      // (cleared by dismountVehicleDriver's own alight, which drops the
      // occupant relationship entirely), there is nothing left on `vehicle`
      // itself to reset here.
    }
    return 'blocked';
  }

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
function handleOccupancyBlock(state: GameState, emp: Employee, vehicle: Vehicle, leg: Leg, blockedStep: { x: number; z: number }, result: LocomotionResult, emitter?: EventEmitter): LegMoveOutcome {
  const wasStuckBefore = emp.isMoveStuck;
  emp.vehicleWaitingTicks++;

  if (emp.vehicleWaitingTicks < VEHICLE_OCCUPANCY_REROUTE_THRESHOLD) return 'blocked';

  const reroute = findPathAvoidingOtherVehicles(state, emp, vehicle, leg.destX, leg.destZ);
  if (reroute.found) {
    const outcome = advanceAlongPath({
      x: emp.x, z: emp.z,
      walkSpeed: getVehicleDefByTier(vehicle.type, vehicle.tier).speed,
      destinationX: leg.destX, destinationZ: leg.destZ,
      consecutiveFailures: 0, isStuck: false,
      path: reroute,
      // A reroute is trusted immediately — never compared against a stale
      // main-route commitment from before the occupancy block, and never
      // against pre-reroute move history either (the same reasoning as
      // `committed` above): a rerouted hop is a different route from a
      // different resolved target, so a coincidental match against where the
      // agent stood 2 ticks before the reroute is not an oscillation.
      committed: NULL_ROUTE_COMMITMENT,
      moveHistoryX: null,
      moveHistoryZ: null,
    });

    emp.moveConsecutiveFailures = outcome.consecutiveFailures;
    emp.isMoveStuck = false;
    emp.vehicleWaitingTicks = 0;
    // #1166: hold the route that got us moving, instead of throwing it away
    // and repathing back into this same blocker next tick.
    markVehicleDetour(emp, blockedStep.x, blockedStep.z);
    writeCommitted(emp, outcome.committed);
    writeMoveHistory(emp, outcome.moveHistoryX, outcome.moveHistoryZ);

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
    writeVehiclePosition(state, vehicle, outcome.x, outcome.z);
    result.moved.push(emp.id);
    result.moved.push(vehicle.id);
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
  // clear rather than pile on a second relocation order. "Moving"/"has a
  // task" are re-derived (#1138) rather than read off the deleted
  // Vehicle.state/.task fields: a driven blocker mid-itinerary is treated as
  // already relocating, and any reservation still means it's genuinely busy.
  if (isVehicleCurrentlyDriving(blocker, state.employees.employees)) return true;
  if (getVehicleReservation(state.vehicles, blocker.id) !== null) return false;

  const freeCell = findNearestFreeCellForVehicle(state, blocker);
  if (!freeCell) return false;

  const blockerDriverId = vehicleDriverId(blocker);
  if (blockerDriverId !== null) {
    moveTo(state, blockerDriverId, { x: freeCell.x, z: freeCell.z });
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

  blocker.x = x;
  blocker.z = z;

  // A driverless blocker is stationary both before and after this instant
  // teleport (#1138) — there is no vehicle-native 'moving' state left to read.
  updateVehicleCellOccupancy(state, blocker, true, true, prevX, prevZ);
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
function writeVehiclePosition(state: GameState, vehicle: Vehicle, x: number, z: number): void {
  const prevX = Math.round(vehicle.x);
  const prevZ = Math.round(vehicle.z);

  vehicle.x = x;
  vehicle.z = z;

  // TODO(#1138): wasStationary/isStationaryNow used to read the deleted
  // Vehicle.state field (true only on the very first tick a stationary
  // vehicle starts driving). Hardcoded here to "was, isn't now" — always
  // clears the old cell, never marks the new one occupied while actively
  // driving, which matches every steady-state driving tick; only the exact
  // "already on the destination cell the instant driving starts" edge case
  // differs from the old behaviour.
  updateVehicleCellOccupancy(state, vehicle, true, false, prevX, prevZ);
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
  // #1138: task/state used to snap to idle here, then briefly take on the
  // reserved role's arrival task as a display mirror — both derived,
  // display-only concerns now (VehicleStatus.computeVehicleStatus), so there
  // is nothing left on `vehicle` itself to write on arrival.
  let drivenVehicle: Vehicle | undefined;
  if (leg.mode === 'drive' && leg.vehicleId !== null) {
    drivenVehicle = state.vehicles.vehicles.find(v => v.id === leg.vehicleId);
  }

  const step = leg.onArrive;
  if (step.kind === 'none') return true;

  if (step.kind === 'effect') {
    // A drive leg's own effect step always resolves against the vehicle that
    // very leg just drove (drivenVehicle, resolved above) — never re-looked
    // up (#1091).
    if (!drivenVehicle) return true;
    const ok = applyArrivalEffect(state, drivenVehicle, step.effectId, emitter);
    if (!ok) {
      interruptActiveAction(state, emp, getVehicleReservation(state.vehicles, drivenVehicle.id), { forceOpenPool: true });
      return false;
    }
    return true;
  }

  if (step.kind === 'board') {
    const vehicle = state.vehicles.vehicles.find(v => v.id === step.vehicleId);
    if (!vehicle) return false;

    const alreadyThere = isMounted(emp.locomotion) && mountedVehicleId(emp.locomotion) === vehicle.id;
    if (!alreadyThere) {
      const boarded = board(state, vehicle.id, emp.id, emitter);
      if (!boarded.success) return false;
    }

    return true;
  }

  // step.kind === 'alight'
  // A borrowed transport-ride vehicle (drivenVehicle, resolved above for this
  // leg's own mode: 'drive') is freed back to the pool the instant its rider
  // alights, instead of staying reserved for an action it was never claimed
  // against.
  if (step.releaseVehicleForActionId !== undefined && drivenVehicle !== undefined
    && getVehicleReservation(state.vehicles, drivenVehicle.id) === step.releaseVehicleForActionId) {
    releaseVehicleReservation(state, step.releaseVehicleForActionId);
  }
  const vehicleId = isMounted(emp.locomotion) ? mountedVehicleId(emp.locomotion) : null;
  if (vehicleId === null) return true; // already on foot — nothing to undo
  return alight(state, vehicleId, emitter).success;
}

