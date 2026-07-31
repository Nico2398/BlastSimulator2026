// BlastSimulator2026 — Vehicle Waiting-Queue Render Offsets
// Extracted from VehicleMesh.ts (#411) to keep that file under the 300-line
// soft limit. Pure, stateless functions — no `this`, no THREE.js objects —
// so they're easy to unit-test independent of the mesh/scene machinery.

import type { Vehicle } from '../core/entities/Vehicle.js';
import { WAITING_QUEUE_SLOT_OFFSETS } from '../core/config/balance.js';

/**
 * Render-only positional offset for a vehicle in the 'waiting' state that
 * shares its target cell with other waiting vehicles (#411 round 2).
 * detectTrafficJam (src/core/events/EventEngine.ts) groups waiting vehicles
 * by exact targetX/targetZ, so the simulation must keep driving every
 * contending vehicle toward the identical point — this offset never touches
 * vehicle.x/z or targetX/targetZ, only where the mesh is drawn, so jam
 * detection is unaffected. Slot assignment is by ascending vehicle id among
 * vehicles sharing that target, so it stays stable frame to frame.
 *
 * Public: GameRenderer's terrain-surface-height correction (syncFromContext)
 * calls snapPosition with x/z straight from GameState every sync, which
 * would otherwise stomp this offset back to the fused raw position between
 * update()'s per-frame lerps — GameRenderer must fold this same offset into
 * the x/z it passes to snapPosition.
 *
 * Round 3 (#411 issue A): an `idle` vehicle already sitting at that exact
 * target cell (x/z equal to the target, e.g. it arrived and stopped) also
 * occupies a slot — otherwise a waiting vehicle's offset could still land
 * on top of it. The idle vehicle itself is never offset (only 'waiting'
 * vehicles get a non-zero return above), it just reserves slot 0 so the
 * waiting vehicles route around it.
 *
 * Round 4 (#411 issue B): the offset alone is not enough — callers must add
 * it to the *shared target point* (targetX/targetZ), not to the vehicle's
 * own raw x/z. Multiple vehicles converging on the same jam land at
 * slightly different raw positions (pathfinding doesn't put them on the
 * exact identical point), so a fixed offset added to each vehicle's own
 * base can still leave two of them under the body-width threshold even
 * though the offsets themselves are correctly spaced apart. Use
 * waitingRenderPosition() below, which anchors to the common point.
 */
export function waitingQueueOffset(vehicle: Vehicle, pool: Vehicle[]): readonly [number, number] {
  if (vehicle.state !== 'waiting') return [0, 0];

  const sharesTarget = (v: Vehicle): boolean =>
    v.targetX === vehicle.targetX && v.targetZ === vehicle.targetZ;

  // Idle vehicles already occupying the target cell claim slot 0 first (in
  // ascending id order) so waiting vehicles never compute an offset that
  // lands on an idle occupant.
  const occupyingIds = pool
    .filter(v => v.state === 'idle' && v.x === v.targetX && v.z === v.targetZ && sharesTarget(v))
    .map(v => v.id)
    .sort((a, b) => a - b);

  const waitingIds = pool
    .filter(v => v.state === 'waiting' && sharesTarget(v))
    .map(v => v.id)
    .sort((a, b) => a - b);

  const sharingTarget = [...occupyingIds, ...waitingIds];

  if (sharingTarget.length <= 1) return [0, 0];

  const slot = sharingTarget.indexOf(vehicle.id) % WAITING_QUEUE_SLOT_OFFSETS.length;
  return WAITING_QUEUE_SLOT_OFFSETS[slot]!;
}

/**
 * Render position for a vehicle, folding in the waiting-queue slot offset
 * (#411 round 4). For a 'waiting' vehicle the offset is anchored to the
 * shared targetX/targetZ — the common point every contending vehicle is
 * driving toward — rather than to the vehicle's own raw x/z, which can
 * differ slightly between vehicles even when they share a target and would
 * otherwise undermine the slot spacing. Non-waiting vehicles (including the
 * idle occupant reserving slot 0) get a zero offset and render at their own
 * x/z, unchanged.
 */
export function waitingRenderPosition(vehicle: Vehicle, pool: Vehicle[]): readonly [number, number] {
  if (vehicle.state !== 'waiting') return [vehicle.x, vehicle.z];
  const [offsetX, offsetZ] = waitingQueueOffset(vehicle, pool);
  return [vehicle.targetX + offsetX, vehicle.targetZ + offsetZ];
}
