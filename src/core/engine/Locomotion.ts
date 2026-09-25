// BlastSimulator2026 — Locomotion (#1089)
// The only mover: walks every alive employee's current itinerary leg one
// tick's worth of movement, and — for a mounted employee — writes their
// vehicle's x/z from theirs. That write is the only place a vehicle's
// position ever changes. Replaces tickVehicle + tickEmployeeMovement
// (EntityMovementTick.ts) and VehicleOccupancyReroute.ts, whose reroute/
// escalation logic is absorbed below. An employee with no itinerary does not
// move (#1178, single-mover unification) — every walk goes through moveTo.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { Employee } from '../entities/Employee.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { getVehicleDefByTier, vehicleDriverId, isVehicleCurrentlyDriving, getVehicleReservation, vehicleRequiredClearanceCells } from '../entities/Vehicle.js';
import type { Leg, Itinerary } from './Itinerary.js';
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
import { moveTo, syncItineraryMirrors } from './MoveTo.js';
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
  /**
   * Vehicle ids whose position was written this tick in a way I4
   * (`vehicle_moved_without_occupant`, WorldInvariants.ts) should treat as
   * legitimate (#1115) — either a genuine, occupant-validated drive leg, OR a
   * deliberate system relocation with no occupant at all, like
   * `relocateDriverlessVehicle` (below), which pushes here for exactly that
   * case. Not a strict subset of `moved`: `moved` mixes employee AND vehicle
   * ids from ordinary itinerary movement, while a driverless relocation
   * writes the vehicle's position and records it here without ever pushing
   * that same id into `moved`. WorldInvariants.ts's I4 check uses this as its
   * authoritative "moved legitimately" signal instead of re-deriving it from
   * before/after occupancy, which cannot tell a same-tick board-drive-alight
   * cycle (occupantIds reads empty at both tick-start and tick-end, even
   * though the vehicle was genuinely, briefly occupied while it moved) from a
   * real "moved with nobody ever driving it" bug.
   */
  vehiclesMoved: number[];
}

/**
 * The only mover. Walks every alive employee's current itinerary leg one
 * tick's worth of movement, and — for a mounted employee — writes their
 * vehicle's x/z from theirs. The only place a vehicle's position ever
 * changes. An employee with no itinerary (destinationX/Z, if set, is a
 * read-only mirror — MoveTo.ts's syncItineraryMirrors) does not move.
 */
export function tickLocomotion(state: GameState, emitter?: EventEmitter): LocomotionResult {
  const result: LocomotionResult = { moved: [], arrived: [], stuck: [], abandoned: [], vehiclesMoved: [] };

  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    if (emp.itinerary !== null) advanceItinerary(state, emp, result, emitter);
  }

  return result;
}

// ── Itinerary-driven movement ──

/** Whether (x, z) satisfies `leg`'s own arrival test — exact-cell for most legs, within one tile for a board leg. */
function isLegArrived(x: number, z: number, leg: Leg): boolean {
  if (leg.arrival === 'adjacent') {
    return Math.max(Math.abs(x - leg.destX), Math.abs(z - leg.destZ)) <= 1;
  }
  return x === leg.destX && z === leg.destZ;
}

/**
 * Clears a dead itinerary and, when it belonged to a still-claimed
 * vehicle-gated action, releases that claim too (#1115). An itinerary that
 * fails before reaching its own arrival step — a board leg `board()` refuses
 * (seat taken, licence gone), or a drive leg whose vehicle was reassigned
 * mid-route (`advanceLeg`'s own 'aborted' outcome) — otherwise leaves
 * `emp.activeActionId` dangling: no itinerary, no destinationX/Z fallback
 * (vehicle-gated claims have none — see promoteVehicleGatedAction's own
 * identical #1115 fix for a claim that never even got an itinerary), with the
 * vehicle reservation this claim took still exclusively held for a driver who
 * will never reach it. `interruptActiveAction`'s own `forceOpenPool: true` is
 * the same "confirmed, non-recoverable impasse" release the stuck-move-abandon
 * path below already uses — releasing here, rather than leaving
 * WorldInvariants.ts's I5 check to find the reservation stale on some later
 * tick, lets the ordinary dispatch loop retry it (this employee or another)
 * instead. A no-op when `activeActionId` is already null (already released by
 * a caller further up, e.g. the stuck-move-abandon branch just below) or
 * names an on-foot action (requiredVehicleRole === null) — an on-foot
 * itinerary failure has its own recovery path (a retry next tick) and this
 * release is scoped to the vehicle-reservation staleness I4/I5 exist to
 * catch.
 */
function clearItineraryOnFailure(state: GameState, emp: Employee): void {
  emp.itinerary = null;
  clearVehicleDetour(emp);
  syncItineraryMirrors(emp);

  if (emp.activeActionId !== null) {
    const action = state.pendingActions.find(a => a.id === emp.activeActionId);
    if (action !== undefined && action.requiredVehicleRole !== null) {
      interruptActiveAction(state, emp, action.id, { forceOpenPool: true });
    }
  }
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
      clearItineraryOnFailure(state, emp);
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
        clearItineraryOnFailure(state, emp);
        break;
      }
      if (outcome === 'blocked') break;
      if (!isLegArrived(emp.x, emp.z, leg)) break;
    }

    const ok = applyArrivalStep(state, emp, leg, itinerary, emitter);

    // A board arrival step's post-board handling (evacuation redrive,
    // fragment-work handoff) may itself have installed a brand-new
    // itinerary, or cleared this one — either way it supersedes what this
    // loop was walking, so stop here rather than mutate an object
    // emp.itinerary no longer even points to. (An 'alight' step's own
    // mid-itinerary side effect is restored by applyArrivalStep itself
    // before returning — see its own #1115 doc comment — so this check no
    // longer fires for that case.)
    if (emp.itinerary !== itinerary) break;

    if (!ok) {
      clearItineraryOnFailure(state, emp);
      break;
    }

    itinerary.legs.shift();
    // #1166: the detour latch is scoped to the leg that recorded it — the
    // next leg starts from a clean route and finds its own blockers.
    clearVehicleDetour(emp);
    syncItineraryMirrors(emp);
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

  // Snapped through NavGrid's own (nearest-cell, round-based) convention
  // rather than handed to findPath continuous (#1166): Pathfinding.ts's own
  // clampToGrid floors instead, which can choose a start cell up to a full
  // diagonal away from the agent's true nearest cell — see this file's own
  // NavGrid.clampX/clampZ usage throughout AgentAdvance.ts for the same fix.
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
      ? findPath(state.navGrid, {
          agentId: emp.id, fromX: driveFromX, fromZ: driveFromZ, toX: leg.destX, toZ: leg.destZ, avoidVehicles,
          ...(isDrive && { requiredClearance: vehicleRequiredClearanceCells(vehicle!) }),
        })
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

    // A leg whose destination sits outside the NavGrid (an unreachable
    // target moveTo installed anyway via allowUnreachable, #1178) has its
    // route silently clamped by findPath — outcome.isPathComplete goes true
    // once the agent exhausts that clamped route, but outcome.x/z then stops
    // one cell short of leg.destX/destZ forever, and isLegArrived (this
    // file's own exact-match test) never agrees the leg is done. Snap to the
    // leg's own literal destination on path completion, mirroring the
    // deleted legacy destinationX/Z walker's identical forced assignment —
    // for a genuinely reachable target this changes nothing (the clamped
    // route's last waypoint already IS destX/destZ), and for a clamped one it
    // is what makes arrival — and so `beginRestTravel`'s and a claimed
    // `general_work`'s own best-effort walk — resolve instead of stalling in
    // 'traveling' forever (confirmed live via needs-drain-visual.json).
    if (outcome.isPathComplete) {
      emp.x = leg.destX;
      emp.z = leg.destZ;
    }
    if (isDrive) writeVehiclePosition(state, vehicle!, emp.x, emp.z, isLegArrived(emp.x, emp.z, leg));

    // Position genuinely advanced this tick — record it regardless of
    // whether the isStuck-abandon branch below also fires (an oscillating
    // tick can be both "moved" and "abandoned" at once; they're independent).
    result.moved.push(emp.id);
    if (isDrive) {
      result.moved.push(vehicle!.id);
      result.vehiclesMoved.push(vehicle!.id);
    }
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
        clearItineraryOnFailure(state, emp);
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
    writeVehiclePosition(state, vehicle, outcome.x, outcome.z, isLegArrived(outcome.x, outcome.z, leg));
    result.moved.push(emp.id);
    result.moved.push(vehicle.id);
    result.vehiclesMoved.push(vehicle.id);
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
  if (relocateDestinationBlocker(state, leg.destX, leg.destZ, vehicle.id, result)) return 'blocked';

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
 * (no blocker, or one that cannot be relocated at all). `result` is threaded
 * through to `relocateDriverlessVehicle` (#1115) — see that function's own
 * doc comment for why a third, legitimate, occupant-less mover needs to
 * record itself into `vehiclesMoved` too.
 */
function relocateDestinationBlocker(
  state: GameState, destX: number, destZ: number, requesterVehicleId: number, result: LocomotionResult,
): boolean {
  const blocker = state.vehicles.vehicles.find(v => v.id !== requesterVehicleId && Math.round(v.x) === destX && Math.round(v.z) === destZ);
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
    relocateDriverlessVehicle(state, blocker, freeCell.x, freeCell.z, result);
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
 *
 * Records `blocker.id` into `result.vehiclesMoved` (#1115) — WorldInvariants.ts's
 * I4 check treats that set as the whole authoritative "moved legitimately
 * this tick" signal, and this is the one mover in the file that genuinely,
 * deliberately moves a vehicle with no occupant at all: without recording it
 * here too, every driverless-blocker relocation reads as I4's exact "moved
 * with nobody ever driving it" violation the instant I4 becomes fatal —
 * confirmed live via tutorial-interactive-revolt.integration.test.ts's own
 * #707 repro.
 */
function relocateDriverlessVehicle(state: GameState, blocker: Vehicle, x: number, z: number, result: LocomotionResult): void {
  const prevX = Math.floor(blocker.x);
  const prevZ = Math.floor(blocker.z);

  blocker.x = x;
  blocker.z = z;
  result.vehiclesMoved.push(blocker.id);

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

/**
 * Writes a driving employee's advance onto their vehicle — the only place a
 * vehicle's x/z ever changes — and keeps NavCell.vehicleOccupied in step:
 * `isStationaryNow` is the calling leg's own arrival test (`isLegArrived`)
 * passing this tick, so a leg that just arrived marks the cell it stopped on,
 * and a leg still mid-route leaves it unmarked. The cell is freed the next
 * tick a new leg's `writeVehiclePosition` call finds the rounded cell has
 * changed (`updateVehicleCellOccupancy`'s own `cellChanged` check) — driving
 * away from a stopped, occupied cell frees it without this function needing
 * to know that on its own.
 */
function writeVehiclePosition(state: GameState, vehicle: Vehicle, x: number, z: number, isStationaryNow: boolean): void {
  const prevX = Math.round(vehicle.x);
  const prevZ = Math.round(vehicle.z);

  vehicle.x = x;
  vehicle.z = z;

  updateVehicleCellOccupancy(state, vehicle, true, isStationaryNow, prevX, prevZ);
}

/**
 * The immediate next grid cell along a found path — the one occupancy is
 * checked against. Mirrors the old nextGridStep.
 *
 * `waypoints[0]` is always the drive leg's own starting cell as `findPath`
 * received it — `advanceLeg`'s `driveFromX`/`driveFromZ`, built via
 * `NavGrid.clampX`/`clampZ`, which round to the nearest cell, not floor to
 * it. Comparing against `Math.floor(x)`/`Math.floor(z)` here used a
 * different convention than the one that produced `waypoints[0]`, so for any
 * position whose fractional part is >= 0.5 (round and floor disagree —
 * roughly half of every tick spent driving) `atFirst` read false even though
 * the agent's rounded position already equalled the path's own first
 * waypoint. That misidentified the agent's own current cell as the "next"
 * step to occupancy-check, and a live vehicle parked exactly there (pure
 * coincidence of position, nothing blocking the real route) read as
 * `isOccupiedByOtherVehicle`, triggering `handleOccupancyBlock`'s stuck-wait
 * and, past `VEHICLE_OCCUPANCY_REROUTE_THRESHOLD`, a full reroute away from
 * every other vehicle's cell — a multi-tick detour for an obstacle that was
 * never really in the way. Reproduced live: a drill_rig routed around a
 * building's clearance-insufficient ring (#1154) happened to cross a parked
 * debris_hauler's cell partway through, at a position whose fraction alone
 * decided whether this function saw it as "already there" or "blocked
 * ahead" — a 20+ tick detour on one seed, nothing on the next. Matching
 * `clampX`/`clampZ`'s own rounding fixes the comparison at its source.
 */
function nextGridStep(x: number, z: number, waypoints: Array<{ x: number; z: number }>): { x: number; z: number } | null {
  if (waypoints.length === 0) return null;
  const first = waypoints[0]!;
  const atFirst = Math.round(x) === first.x && Math.round(z) === first.z;
  if (atFirst && waypoints.length > 1) return waypoints[1]!;
  return first;
}

function isOccupiedByOtherVehicle(state: GameState, selfVehicleId: number, x: number, z: number): boolean {
  return state.vehicles.vehicles.some(v => v.id !== selfVehicleId && Math.round(v.x) === x && Math.round(v.z) === z);
}

/**
 * Re-runs findPath with every OTHER live vehicle's current cell temporarily
 * marked vehicleOccupied, so avoidVehicles:true actually routes around them.
 * Marks are reverted before returning — no lasting mutation to state.navGrid.
 * Mirrors the old VehicleOccupancyReroute.ts's findPathAvoidingOtherVehicles.
 *
 * `avoidVehicles:true` on `findPath` gates on `isImpassable`'s shared
 * `isCellOccupied` (NavGrid.ts), which — since #954 folded fragment
 * occupancy into the same "occupied" predicate a foot leg avoids — treats a
 * cell with any on-ground fragment on it as impassable too, not just a
 * vehicle-occupied one. That is correct for the pedestrian sense the
 * predicate was extended for, but wrong here: this function's whole purpose
 * is a vehicle escalation avoiding *other vehicles specifically* (its name
 * and its own doc above predate #954 and never meant fragments), and the one
 * caller of it (`handleOccupancyBlock`) fires hardest exactly where fragments
 * are thickest — a fresh blast crater a debris_hauler is driving into to
 * collect them. Left unguarded, a reroute attempted from inside (or through)
 * that crater finds every candidate route blocked by the very fragments it
 * is trying to reach, `findPath` reports `found:false`, and the driver is
 * left permanently stuck (isMoveStuck latched forever, since a failed
 * reroute doesn't reset `vehicleWaitingTicks` and every following tick
 * retries and fails the identical search) — reproduced live via
 * rock-fragmenter-breaking.json once #1154's own nextGridStep fix (above)
 * stopped silently skipping this escalation on a false-positive block and
 * let it actually run into this pre-existing conflation for the first time.
 * Fragment occupancy is temporarily zeroed for the duration of this call —
 * the same revert-in-`finally` shape already used for the vehicle marks —
 * rather than threading a vehicle-only occupancy variant through every
 * `isImpassable` call site in Pathfinding.ts, which would touch far more
 * than this one escalation path actually needs.
 */
function findPathAvoidingOtherVehicles(state: GameState, emp: Employee, vehicle: Vehicle, destX: number, destZ: number): PathResult {
  const grid = state.navGrid!;
  const marked: Array<{ x: number; z: number; prev: boolean }> = [];
  const unmarkedFragments: Array<{ x: number; z: number; prev: number }> = [];

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

    for (const tracked of state.logistics.fragments) {
      if (tracked.state !== 'on_ground') continue;
      const fx = Math.round(tracked.fragment.position.x);
      const fz = Math.round(tracked.fragment.position.z);
      const cell = grid.cellAt(fx, fz);
      if (!cell || !cell.fragmentOccupancy) continue;
      unmarkedFragments.push({ x: fx, z: fz, prev: cell.fragmentOccupancy });
      cell.fragmentOccupancy = 0;
    }

    return findPath(grid, {
      agentId: emp.id, fromX: emp.x, fromZ: emp.z, toX: destX, toZ: destZ, avoidVehicles: true,
      requiredClearance: vehicleRequiredClearanceCells(vehicle),
    });
  } finally {
    for (const mark of marked) {
      const cell = grid.cellAt(mark.x, mark.z);
      if (cell) cell.vehicleOccupied = mark.prev;
    }
    for (const mark of unmarkedFragments) {
      const cell = grid.cellAt(mark.x, mark.z);
      if (cell) cell.fragmentOccupancy = mark.prev;
    }
  }
}

// ── Arrival steps ──

/**
 * Applies `leg`'s arrival step. Returns false when the step fails (vehicle
 * gone/taken) — the caller clears the itinerary and leaves the employee on
 * foot where they stand. `itinerary` is the live itinerary `leg` belongs to
 * — needed (#1115) only by the 'alight' branch, to restore it after
 * `alight()`'s own itinerary-clearing side effect when this step is a
 * mid-itinerary alight rather than a standalone dismount.
 */
function applyArrivalStep(state: GameState, emp: Employee, leg: Leg, itinerary: Itinerary, emitter?: EventEmitter): boolean {
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

  // #1115 fix: alight() (Mount.ts) unconditionally nulls `employee.itinerary`
  // as its own side effect — correct for its out-of-band callers
  // (dismountVehicleDriver, the console `vehicle driver none` command), which
  // alight OUTSIDE of any itinerary walk and mean to discard whatever stale
  // itinerary that employee still carried. Called from HERE, mid-walk, as
  // THIS leg's own arrival step, the itinerary alight() just nulled is not
  // stale at all — it is the live itinerary `advanceItinerary` is in the
  // middle of, with further legs (a board leg onto the NEXT vehicle, then its
  // own drive legs) still queued behind this one. Left unrestored,
  // `advanceItinerary`'s own `emp.itinerary !== itinerary` check (its post-
  // arrival-step guard for a genuine handoff, e.g. a board leg's own
  // evacuation-redrive/fragment-work post-processing) reads this exactly like
  // that legitimate case and stops the walk right here, silently truncating
  // a cross-vehicle promotion's own alight-then-board itinerary after just
  // its first (zero-length) leg — activeActionId stays pointed at the action,
  // but nothing ever resumes walking it and the vehicle reservation this
  // claim took sits stale for good (WorldInvariants.ts's I5 check flags
  // exactly this — confirmed live via buildings.integration.test.ts's own
  // starved-debris_hauler-backlog case, once I4/I5 became fatal: a driver's
  // own alight-to-switch-vehicles leg, mid-promoteVehicleGatedAction, lost
  // the rest of its itinerary this exact way). Restoring the reference right
  // after a successful alight is safe for alight()'s OTHER, legitimate
  // itinerary-ending use (an evacuation drive's own final leg, MoveTo.ts's
  // alightOnArrival) too: that leg is always the LAST one, so the caller's
  // own post-arrival-step `itinerary.legs.shift()` immediately empties it
  // right back to null on its own — restoring here only changes anything for
  // an alight leg with siblings still queued behind it.
  const result = alight(state, vehicleId, emitter);
  if (result.success && emp.itinerary === null) {
    emp.itinerary = itinerary;
  }
  return result.success;
}

