// BlastSimulator2026 — Vehicle occupancy-block reroute/escalation (#591).
// Split out of EntityMovementTick.ts (mirrors that file's own #407 extraction
// of AgentAdvance.advanceAlongPath) once the occupancy-reroute logic pushed
// EntityMovementTick.ts past the 300-line file limit. Handles the case where
// tickVehicleOnNavGrid's next grid step is occupied by another live vehicle:
// wait, then past VEHICLE_OCCUPANCY_REROUTE_THRESHOLD ticks of waiting,
// attempt a one-shot reroute avoiding every other vehicle's current cell, and
// escalate to stuck if no such route exists.

import type { GameState } from '../state/GameState.js';
import { getVehicleDefByTier, moveVehicle, type Vehicle } from '../entities/Vehicle.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { findPath, type PathResult } from '../nav/Pathfinding.js';
import { advanceAlongPath, type AdvanceAlongPathOutcome } from '../nav/AgentAdvance.js';
import { VEHICLE_OCCUPANCY_REROUTE_THRESHOLD } from '../config/balance.js';
import { markVehicleWaiting, setVehicleIdle, isCellOccupiedByOtherVehicle, updateVehicleCellOccupancy } from './EntityMovementTick.js';

/**
 * Applies an advanceAlongPath outcome to a vehicle: position, moving state,
 * waitingTicks reset, and — on path completion — snapping to the target and
 * idling. Shared by tickVehicleOnNavGrid's normal-path branch and the
 * reroute-success branch here; only the isMoveStuck source differs between
 * the two callers (the normal path takes outcome.isStuck, a reroute always
 * forces false), so it is passed explicitly rather than read off outcome.
 */
export function applyAdvanceOutcome(
  vehicle: Vehicle,
  outcome: AdvanceAlongPathOutcome,
  isMoveStuck: boolean,
): void {
  vehicle.moveConsecutiveFailures = outcome.consecutiveFailures;
  vehicle.isMoveStuck = isMoveStuck;
  vehicle.x = outcome.x;
  vehicle.z = outcome.z;
  vehicle.state = 'moving';
  vehicle.waitingTicks = 0;

  if (outcome.isPathComplete) {
    vehicle.x = vehicle.targetX;
    vehicle.z = vehicle.targetZ;
    setVehicleIdle(vehicle);
  }
}

/**
 * Handles a vehicle whose next grid step is occupied by another live
 * vehicle: marks it waiting, and once it has waited
 * VEHICLE_OCCUPANCY_REROUTE_THRESHOLD consecutive ticks, attempts a one-shot
 * reroute avoiding every other vehicle's current cell
 * (findPathAvoidingOtherVehicles). A successful reroute applies its outcome
 * immediately (same tick); a failed one escalates the vehicle to stuck,
 * using wasStuckBeforeTick — captured by the caller before the top-level
 * findPath/advanceAlongPath call reset vehicle.isMoveStuck to false — for the
 * rising-edge emit guard, since vehicle.isMoveStuck read here would always be
 * false regardless of whether this vehicle was already stuck from a prior tick.
 */
export function handleVehicleOccupancyBlock(
  state: GameState,
  vehicle: Vehicle,
  emitter: EventEmitter | undefined,
  wasStuckBeforeTick: boolean,
): void {
  markVehicleWaiting(vehicle);

  if (vehicle.waitingTicks < VEHICLE_OCCUPANCY_REROUTE_THRESHOLD) return;

  const reroute = findPathAvoidingOtherVehicles(state, vehicle);

  if (reroute.found) {
    const rerouteOutcome = advanceAlongPath({
      x: vehicle.x,
      z: vehicle.z,
      walkSpeed: getVehicleDefByTier(vehicle.type, vehicle.tier).speed,
      destinationX: vehicle.targetX,
      destinationZ: vehicle.targetZ,
      consecutiveFailures: 0,
      isStuck: false,
      path: reroute,
    });

    applyAdvanceOutcome(vehicle, rerouteOutcome, false);
    return;
  }

  // #689: every route to the target is blocked by a live vehicle, including
  // the destination cell itself — a permanent deadlock (a driver reassigned
  // mid-drilling can leave a vehicle idle on exactly the tile a *different*
  // pending action needs). isLicensedForRole/findFreeVehicleForRole only gate
  // *claiming a vehicle-gated task* (drilling, digging, hauling) — driving
  // itself has never required the role licence, so any employee's vehicle
  // can relocate one out of the way. A driven idle blocker relocates by
  // driving itself clear (moveVehicle, below) — canTickVehicle (#947)
  // requires driverId !== null to advance a 'moving' task on tick, and a
  // driven vehicle satisfies that. A driverless idle blocker has nobody to
  // drive it, so it is relocated directly (#1087 follow-up): Mount's
  // Chebyshev-radius boarding (board/alight, Mount.ts) reassigns a
  // vehicle-gated action's vehicle far more often than the old exact-cell
  // model did — a reclaiming employee's own nearest-vehicle pick
  // (findFreeVehicleForRole) need not be the one already sitting at the
  // target, so a released, driverless rig can now end up permanently
  // abandoned on a *different*, still-incomplete action's own target cell,
  // with no driver ever available to drive it off (confirmed live:
  // level1-lose-ecology.json's own H44 stalled at holeCount 48/49 forever —
  // 8000+ ticks with zero progress — behind exactly this kind of orphaned
  // rig). Nothing needs to *drive* a driverless, unreserved, idle vehicle
  // out of the way — it has no task of its own to interrupt — so it is
  // simply repositioned to the nearest free cell outright, the same
  // satirical "someone shoves the abandoned car aside" beat the driven case
  // already plays out over several ticks of animated driving. A blocker
  // that is reserved, mid-task, or has nowhere free to go will never clear
  // on its own either way — fall through to the same stuck escalation as
  // any other deadlock rather than wait on it forever.
  const blocker = state.vehicles.vehicles.find(
    v => v.id !== vehicle.id && v.x === vehicle.targetX && v.z === vehicle.targetZ,
  );
  if (blocker) {
    if (blocker.task === 'moving') {
      // Already relocating — this trigger or a prior tick's — give it time
      // to clear rather than escalate mid-relocation.
      return;
    }
    if (blocker.task === 'idle' && blocker.reservedForActionId === null) {
      const freeCell = findNearestFreeCellForVehicle(state, blocker);
      if (freeCell) {
        if (blocker.driverId !== null) {
          moveVehicle(state.vehicles, blocker.id, freeCell.x, freeCell.z);
        } else {
          relocateDriverlessVehicle(state, blocker, freeCell.x, freeCell.z);
        }
        return;
      }
      // No free cell nearby either — nothing left to try, fall through.
    }
  }

  // No route avoids the obstacle either, and nothing occupies the target
  // itself that can be relocated — escalate to stuck, same rising-edge emit
  // pattern as tickVehicleOnNavGrid's !outcome.pathFound branch.
  vehicle.isMoveStuck = true;
  if (!wasStuckBeforeTick) {
    emitter?.emit('vehicle:stuck', { vehicleId: vehicle.id });
  }
}

/**
 * Direct repositioning for a driverless idle blocker (#1087 follow-up): no
 * driver exists to stage a 'moving' task through the ordinary drive
 * machinery (canTickVehicle would never advance it — #947), and none is
 * needed — an unreserved, driverless vehicle has no task of its own in
 * flight to interrupt, so it is simply placed on `x`/`z` outright. Reuses
 * tickVehicle's own updateVehicleCellOccupancy (EntityMovementTick.ts) to
 * keep NavCell.vehicleOccupied in sync, so foot/vehicle pathfinding
 * immediately sees the old cell as free and the new one as occupied rather
 * than waiting for the next tick's reconciliation.
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
 * finds somewhere to go. Returns null when nothing nearby qualifies (fully
 * boxed in); the caller leaves the blocker in place and the stuck vehicle
 * keeps waiting rather than escalating on a relocation that would fail anyway.
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
        if (isCellOccupiedByOtherVehicle(state, blocker, x, z)) continue;

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
 * Re-runs findPath with every OTHER live vehicle's current cell
 * temporarily marked vehicleOccupied, so avoidVehicles:true actually
 * routes around them. Marks are reverted before returning — no lasting
 * mutation to state.navGrid, no cross-tick side effect.
 */
export function findPathAvoidingOtherVehicles(state: GameState, vehicle: Vehicle): PathResult {
  const grid = state.navGrid!;
  const markedCells: { x: number; z: number; prev: boolean }[] = [];

  try {
    for (const other of state.vehicles.vehicles) {
      if (other.id === vehicle.id) continue;
      const cx = Math.floor(other.x);
      const cz = Math.floor(other.z);
      const cell = grid.cellAt(cx, cz);
      if (!cell || cell.vehicleOccupied) continue;
      markedCells.push({ x: cx, z: cz, prev: cell.vehicleOccupied });
      cell.vehicleOccupied = true;
    }

    return findPath(grid, {
      agentId: vehicle.id,
      fromX: vehicle.x,
      fromZ: vehicle.z,
      toX: vehicle.targetX,
      toZ: vehicle.targetZ,
      avoidVehicles: true,
    });
  } finally {
    for (const mark of markedCells) {
      const cell = grid.cellAt(mark.x, mark.z);
      if (cell) cell.vehicleOccupied = mark.prev;
    }
  }
}
