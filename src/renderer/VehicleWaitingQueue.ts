// BlastSimulator2026 — Vehicle Waiting-Queue Render Offsets
// Extracted from VehicleMesh.ts (#411) to keep that file under the 300-line
// soft limit. Pure, stateless functions — no `this`, no THREE.js objects —
// so they're easy to unit-test independent of the mesh/scene machinery.

import type { Vehicle } from '../core/entities/Vehicle.js';
import { resolveVehicleDriver } from '../core/entities/Vehicle.js';
import type { Employee } from '../core/entities/Employee.js';
import { WAITING_QUEUE_SLOT_OFFSETS } from '../core/config/balance.js';

/**
 * The cell `vehicle`'s driver is currently queued to reach, or null when
 * nobody is aboard, the driver isn't waiting on occupancy right now
 * (`vehicleWaitingTicks === 0`), or their current itinerary leg isn't a
 * drive leg — replaces the deleted `vehicle.state`/`.targetX`/`.targetZ`
 * reads (#1138): a vehicle carries no display state of its own any more, so
 * "waiting, heading toward X/Z" is re-derived from the driving employee's
 * own fields.
 */
function currentDriveTarget(vehicle: Vehicle, employees: readonly Employee[]): { x: number; z: number } | null {
  const driver = resolveVehicleDriver(vehicle, employees);
  if (!driver || driver.vehicleWaitingTicks <= 0) return null;
  const leg = driver.itinerary?.legs[0];
  if (!leg || leg.mode !== 'drive') return null;
  return { x: leg.destX, z: leg.destZ };
}

/**
 * Render-only positional offset for a vehicle waiting on occupancy that
 * shares its drive target with other waiting vehicles (#411 round 2).
 * detectTrafficJam (src/core/events/EventEngine.ts) groups waiting vehicles
 * by their driver's exact current-leg destX/destZ, so the simulation must
 * keep driving every contending vehicle toward the identical point — this
 * offset never touches vehicle.x/z or the leg's own destX/destZ, only where
 * the mesh is drawn, so jam detection is unaffected. Slot assignment is by
 * ascending vehicle id among vehicles sharing that target, so it stays
 * stable frame to frame.
 *
 * Public: GameRenderer's terrain-surface-height correction (syncFromContext)
 * only corrects `y` (setSurfaceY) and never touches x/z (#520) — this offset
 * is applied every frame inside VehicleMesh's own update() call, as the
 * target of its per-frame tween, so it survives syncs without any snap-time
 * folding.
 *
 * Round 4 (#411 issue B): the offset alone is not enough — callers must add
 * it to the *shared target point*, not to the vehicle's own raw x/z.
 * Multiple vehicles converging on the same jam land at slightly different
 * raw positions (pathfinding doesn't put them on the exact identical
 * point), so a fixed offset added to each vehicle's own base can still
 * leave two of them under the body-width threshold even though the offsets
 * themselves are correctly spaced apart. Use waitingRenderPosition() below,
 * which anchors to the common point.
 *
 * #1138: the "an idle vehicle already sitting at the shared target claims
 * slot 0" carve-out (round 3, #411 issue A) is dropped along with
 * `Vehicle.state`/`.targetX`/`.targetZ` — there is no vehicle-native "idle,
 * parked exactly on this cell" signal left to distinguish that case from any
 * other stationary vehicle.
 */
export function waitingQueueOffset(vehicle: Vehicle, pool: Vehicle[], employees: readonly Employee[]): readonly [number, number] {
  const target = currentDriveTarget(vehicle, employees);
  if (!target) return [0, 0];

  const sharesTarget = (v: Vehicle): boolean => {
    const t = currentDriveTarget(v, employees);
    return t !== null && t.x === target.x && t.z === target.z;
  };

  const sharingTarget = pool
    .filter(sharesTarget)
    .map(v => v.id)
    .sort((a, b) => a - b);

  if (sharingTarget.length <= 1) return [0, 0];

  const slot = sharingTarget.indexOf(vehicle.id) % WAITING_QUEUE_SLOT_OFFSETS.length;
  return WAITING_QUEUE_SLOT_OFFSETS[slot]!;
}

/**
 * Render position for a vehicle, folding in the waiting-queue slot offset
 * (#411 round 4). For a vehicle waiting on occupancy the offset is anchored
 * to the shared drive target — the common point every contending vehicle is
 * driving toward — rather than to the vehicle's own raw x/z, which can
 * differ slightly between vehicles even when they share a target and would
 * otherwise undermine the slot spacing. Every other vehicle gets a zero
 * offset and renders at its own x/z, unchanged.
 */
export function waitingRenderPosition(vehicle: Vehicle, pool: Vehicle[], employees: readonly Employee[]): readonly [number, number] {
  const target = currentDriveTarget(vehicle, employees);
  if (!target) return [vehicle.x, vehicle.z];
  const [offsetX, offsetZ] = waitingQueueOffset(vehicle, pool, employees);
  return [target.x + offsetX, target.z + offsetZ];
}
