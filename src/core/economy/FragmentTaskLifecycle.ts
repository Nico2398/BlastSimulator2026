// BlastSimulator2026 — Shared task-lifecycle helpers for fragment-targeting vehicle tasks
//
// BoulderBreaking.ts (breaking) and HaulingTask.ts (hauling) are both
// position-gated vehicle tasks that target a fragment: request looks up and
// validates the vehicle, tick drives it toward the fragment's approach cell
// one movement tick at a time, and search picks the nearest reachable
// candidate fragment. This file holds the three steps that are identical
// between the two workflows so BoulderBreaking.ts and HaulingTask.ts only
// carry what differs: eligibility rules, phase names, and what happens on
// arrival.

import type { GameState } from '../state/GameState.js';
import type { Vehicle, VehicleRole } from '../entities/Vehicle.js';
import type { FragmentData } from '../mining/BlastExecution.js';
import type { TrackedFragment } from './Logistics.js';
import { fragmentApproachCell } from './FragmentApproach.js';
import { tickVehicle } from '../engine/EntityMovementTick.js';
import { NavGrid } from '../nav/NavGrid.js';

/**
 * Look up `vehicleId` for a request-phase task entry point (requestBreakBoulder,
 * requestHaulFragment). Both callers keep their own further checks (vehicle
 * type, driver assigned, not already busy) — this only covers the one check
 * that's identical between them: does the vehicle exist at all.
 */
export function findRequestVehicle(
  state: GameState,
  vehicleId: number,
): { success: true; vehicle: Vehicle } | { success: false; error: string } {
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return { success: false, error: 'Vehicle not found' };
  return { success: true, vehicle };
}

/**
 * Look up `vehicleId` and confirm it is a `expectedRole` vehicle, in one step
 * — the first two checks requestBreakBoulder and requestHaulFragment both
 * run before diverging into their own role-specific conditions (driver
 * assigned, not already busy). `wrongRoleError` carries the caller's own
 * wording so the two request entry points keep their distinct error messages.
 */
export function findRequestVehicleOfRole(
  state: GameState,
  vehicleId: number,
  expectedRole: VehicleRole,
  wrongRoleError: string,
): { success: true; vehicle: Vehicle } | { success: false; error: string } {
  const found = findRequestVehicle(state, vehicleId);
  if (!found.success) return found;
  if (found.vehicle.type !== expectedRole) return { success: false, error: wrongRoleError };
  return found;
}

/**
 * Point `vehicle` at `fragment`'s approach cell and advance its movement by
 * one tick. Returns true once the vehicle has arrived (x/z match target) —
 * the caller then performs its own arrival effect (load onto vehicle vs.
 * split it in place) instead of this helper knowing which.
 */
export function driveTowardFragment(state: GameState, vehicle: Vehicle, fragment: FragmentData): boolean {
  const approach = fragmentApproachCell(fragment, state, vehicle.id);
  vehicle.task = 'moving';
  vehicle.targetX = approach.x;
  vehicle.targetZ = approach.z;
  tickVehicle(state, vehicle);
  return vehicle.x === vehicle.targetX && vehicle.z === vehicle.targetZ;
}

/**
 * Nearest 'on_ground' fragment reachable from (originX, originZ) via NavGrid,
 * among those `extraEligible` accepts — the search and reachability check
 * are identical between findReachableOversizedFragment (breaking) and
 * findReachableGroundFragment (hauling); only the per-fragment eligibility
 * predicate differs (oversized-only vs. non-oversized-and-fits-in-storage).
 */
export function findNearestReachableFragment(
  state: GameState,
  vehicleId: number,
  originX: number,
  originZ: number,
  extraEligible: (tracked: TrackedFragment) => boolean,
): number | null {
  if (!state.navGrid) return null;

  const reachable = NavGrid.computeReachableSet(state.navGrid, originX, originZ);
  if (reachable.size === 0) return null;

  let bestId: number | null = null;
  let bestDistSq = Infinity;
  for (const tracked of state.logistics.fragments) {
    if (tracked.state !== 'on_ground') continue;
    if (!extraEligible(tracked)) continue;
    const { x: fx, z: fz } = fragmentApproachCell(tracked.fragment, state, vehicleId);
    if (!reachable.has(fx, fz)) continue;
    const distSq = (fx - originX) ** 2 + (fz - originZ) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestId = tracked.fragment.id;
    }
  }

  return bestId;
}
