// BlastSimulator2026 — Arrival effects (#1091)
//
// Dispatch table for an itinerary leg's `{ kind: 'effect'; effectId: ArrivalEffectId }`
// ArrivalStep (Itinerary.ts) — fired by Locomotion.ts at the instant a leg's
// destination is reached, the same arrival-gated timing every other
// position-dependent action already uses (see the `vehicles` rule). Replaces
// HaulingTask.ts's tickHaulingProgress and BoulderBreaking.ts's
// tickBreakProgress, which used to drive the same three mutations themselves
// from a per-tick phase machine on `Vehicle` (haulingPhase/breakPhase) —
// PlanItinerary.ts's planFragmentTaskItinerary now plans the driving legs
// instead, and this file supplies only what happens on arrival.
//
// A haul_debris/fragment_debris PendingAction's own completion (reservation
// release + record removal) also happens here, at the instant its FINAL
// effect (haul_unload / boulder_split) succeeds — these two action types
// never seed a work timer (ArrivalGate.ts excludes them), so there is no
// other point in the tick where "this action is done" would otherwise be
// noticed.
//
// Effect ids are a closed catalog (ArrivalEffectId, exported from Itinerary.ts,
// which owns the ArrivalStep union) rather than a raw string so the next one
// is a union member and a catalog entry, not a new branch somewhere else —
// see the "Extension without edit" principle.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { vehicleDriverId, getVehicleReservation } from '../entities/Vehicle.js';
import type { FragmentData } from '../mining/BlastExecution.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { isOversized, fragmentBoulder, type Boulder } from '../mining/BlastCalc.js';
import { pickupFragment, deliverToDepot, type TrackedFragment } from '../economy/Logistics.js';
import { Random } from '../math/Random.js';
import { scale, vec3, ZERO } from '../math/Vec3.js';
import { completeVehicleGatedAction } from './VehicleReservation.js';
import type { ArrivalEffectId } from './Itinerary.js';

type ArrivalEffectHandler = (state: GameState, vehicle: Vehicle, emitter?: EventEmitter) => boolean;

/** The PendingAction `vehicle` is currently reserved for, or undefined when it isn't reserved at all (shouldn't happen for a vehicle mid arrival-effect leg, but the caller (`applyArrivalEffect`) treats an unresolved action as a plain failure rather than throwing). */
function findReservedAction(state: GameState, vehicle: Vehicle): PendingAction | undefined {
  const reservedForActionId = getVehicleReservation(state.vehicles, vehicle.id);
  if (reservedForActionId === null) return undefined;
  return state.pendingActions.find(a => a.id === reservedForActionId);
}

/**
 * The find-reserved-action -> extract-fragmentId -> find-on-ground-fragment
 * prefix shared by applyHaulLoad and applyBoulderSplit — both look up the
 * fragment named by the vehicle's reserved action before diverging on their
 * own oversized-polarity check (haul refuses oversized, break requires it).
 * Returns null on any lookup failure: no reserved action, a malformed
 * payload, or the fragment no longer tracked 'on_ground'.
 */
function resolveReservedGroundFragment(
  state: GameState,
  vehicle: Vehicle,
): { fragmentId: number; tracked: TrackedFragment } | null {
  const action = findReservedAction(state, vehicle);
  if (!action) return null;

  const fragmentId = action.payload['fragmentId'];
  if (typeof fragmentId !== 'number') return null;

  const tracked = state.logistics.fragments.find(f => f.fragment.id === fragmentId && f.state === 'on_ground');
  if (!tracked) return null;

  return { fragmentId, tracked };
}

/**
 * Completes the haul_debris/fragment_debris PendingAction `vehicle` is
 * reserved for, once its final effect has succeeded — releasing the
 * reservation, clearing the driver's active-task fields, and removing the
 * action/ghost (completeVehicleGatedAction, VehicleReservation.ts). No-op
 * when the vehicle isn't reserved or has no driver (shouldn't happen at this
 * point, but mirrors the old ArrivalGate.ts's identical guard before it
 * reported a completion).
 */
function completeFragmentGatedAction(state: GameState, vehicle: Vehicle): void {
  const driverId = vehicleDriverId(vehicle);
  const reservedForActionId = getVehicleReservation(state.vehicles, vehicle.id);
  if (reservedForActionId === null || driverId === null) return;
  const employee = state.employees.employees.find(e => e.id === driverId);
  if (!employee) return;
  completeVehicleGatedAction(state, employee, reservedForActionId);
}

/**
 * Fires when a debris_hauler's drive-to-fragment leg arrives: loads the
 * fragment named by the vehicle's active haul_debris action onto
 * `vehicle.payload`. Mirrors the old HaulingTask.ts tickHaulingProgress
 * 'to_fragment' arrival branch (pickupFragment + payload assignment), minus
 * the movement it used to also drive. Never completes the action itself —
 * a haul's own final leg (haul_unload) does that.
 */
export function applyHaulLoad(state: GameState, vehicle: Vehicle, emitter?: EventEmitter): boolean {
  const resolved = resolveReservedGroundFragment(state, vehicle);
  if (!resolved || isOversized(resolved.tracked.fragment.volume)) return false;
  const { fragmentId, tracked } = resolved;

  const loaded = pickupFragment(state.logistics, fragmentId, String(vehicle.id));
  if (!loaded) return false;

  state.navGrid?.removeFragmentOccupant(
    Math.round(tracked.fragment.position.x),
    Math.round(tracked.fragment.position.z),
  );
  vehicle.payload = { fragmentId, massKg: tracked.fragment.mass };
  emitter?.emit('vehicle:haul_loaded', { vehicleId: vehicle.id, fragmentId });
  return true;
}

/**
 * Fires when a debris_hauler's drive-to-depot leg arrives: delivers
 * `vehicle.payload` into logistics/collectedOre and clears the payload.
 * Mirrors the old HaulingTask.ts tickHaulingProgress 'to_depot' arrival
 * branch (deliverToDepot + payload clear) — delivers unconditionally,
 * regardless of whether the destination building still exists/is active at
 * this instant (no re-routing on a vanished depot, matching the
 * building-agnostic storedMassKg/collectedOre credit contract). Completes
 * the haul_debris action this vehicle is reserved for.
 */
export function applyHaulUnload(state: GameState, vehicle: Vehicle, emitter?: EventEmitter): boolean {
  if (vehicle.payload === null) return false;

  const { fragmentId } = vehicle.payload;
  // deliverToDepot's own success/failure must be honored (#1091 fix): it
  // returns false without mutating anything when the named fragment isn't
  // actually tracked 'in_transit' any more (a stale payload, or a fragment
  // reclaimed by something else) — ignoring that and always clearing payload/
  // completing the action regardless would silently report a delivery that
  // never happened.
  const delivered = deliverToDepot(state.logistics, fragmentId, state.collectedOre);
  if (!delivered) return false;

  vehicle.payload = null;
  emitter?.emit('vehicle:haul_delivered', { vehicleId: vehicle.id, fragmentId });
  completeFragmentGatedAction(state, vehicle);
  return true;
}

/**
 * Deterministic seed for one boulder's split — same fragment id at the same
 * tick always breaks into the same shapeSeed sequence (FNV-1a-style mix,
 * matching BlastExecution.ts's fragmentSeedFor pattern). Moved from the old
 * BoulderBreaking.ts (#1091).
 */
function breakSeed(fragmentId: number, tickCount: number): number {
  let seed = 2166136261;
  seed = Math.imul(seed ^ fragmentId, 16777619);
  seed = Math.imul(seed ^ tickCount, 16777619);
  return Math.abs(seed) % 2147483647;
}

/** Highest fragment id currently tracked in logistics, or -1 if none. Moved from the old BoulderBreaking.ts (#1091). */
function highestFragmentId(state: GameState): number {
  let max = -1;
  for (const f of state.logistics.fragments) {
    if (f.fragment.id > max) max = f.fragment.id;
  }
  return max;
}

/**
 * Fires when a rock_fragmenter's drive-to-boulder leg arrives: splits the
 * oversized fragment named by the vehicle's active fragment_debris action
 * into sub-fragments in place. Mirrors the old BoulderBreaking.ts
 * tickBreakProgress body (fragmentBoulder + logistics splice), minus the
 * movement it used to also drive. Always the final (and only) effect of a
 * break itinerary — completes the fragment_debris action this vehicle is
 * reserved for. Never touches `vehicle.payload` — breaking happens in place,
 * nothing is ever loaded onto the vehicle.
 */
export function applyBoulderSplit(state: GameState, vehicle: Vehicle, emitter?: EventEmitter): boolean {
  const resolved = resolveReservedGroundFragment(state, vehicle);
  if (!resolved || !isOversized(resolved.tracked.fragment.volume)) return false;
  const { tracked } = resolved;

  const boulder: Boulder = {
    id: tracked.fragment.id,
    volume: tracked.fragment.volume,
    mass: tracked.fragment.mass,
    rockId: tracked.fragment.rockId,
    oreDensities: tracked.fragment.oreDensities,
  };
  const rng = new Random(breakSeed(tracked.fragment.id, state.tickCount));
  const result = fragmentBoulder(boulder, rng);
  if (!result.success) return false;

  const originalId = tracked.fragment.id;
  // Computed before the splice below (and against the original fragment's own
  // id) so a sub-fragment id can never collide with the boulder just removed
  // or with any other fragment still tracked in logistics.
  let nextId = Math.max(highestFragmentId(state), originalId) + 1;
  const idx = state.logistics.fragments.indexOf(tracked);
  if (idx >= 0) state.logistics.fragments.splice(idx, 1);
  const cellX = Math.round(tracked.fragment.position.x);
  const cellZ = Math.round(tracked.fragment.position.z);
  state.navGrid?.removeFragmentOccupant(cellX, cellZ);

  // Fixture/parent fragments built by hand (e.g. in tests) may omit
  // halfExtents even though FragmentData declares it required — fall back to
  // a cube approximation from the parent's own volume rather than crash.
  const parentHalfExtents = tracked.fragment.halfExtents
    ?? vec3(Math.cbrt(boulder.volume) / 2, Math.cbrt(boulder.volume) / 2, Math.cbrt(boulder.volume) / 2);

  const pieceIds: number[] = [];
  for (const piece of result.fragments) {
    const factor = Math.cbrt(piece.volume / boulder.volume);
    const newFragment: FragmentData = {
      id: nextId++,
      position: tracked.fragment.position,
      volume: piece.volume,
      mass: piece.mass,
      rockId: piece.rockId,
      oreDensities: piece.oreDensities,
      initialVelocity: ZERO,
      isProjection: false,
      halfExtents: scale(parentHalfExtents, factor),
      shapeSeed: rng.nextInt(0, 0x7fffffff),
    };
    state.logistics.fragments.push({ fragment: newFragment, state: 'on_ground', vehicleId: null });
    state.navGrid?.addFragmentOccupant(cellX, cellZ);
    pieceIds.push(newFragment.id);
  }

  emitter?.emit('vehicle:boulder_broken', { vehicleId: vehicle.id, fragmentId: originalId, pieceIds });
  completeFragmentGatedAction(state, vehicle);
  return true;
}

const ARRIVAL_EFFECTS: Record<ArrivalEffectId, ArrivalEffectHandler> = {
  haul_load: applyHaulLoad,
  haul_unload: applyHaulUnload,
  boulder_split: applyBoulderSplit,
};

/**
 * Dispatches an itinerary leg's `{ kind: 'effect' }` ArrivalStep by its
 * `effectId` to the catalog above — the one call site Locomotion.ts's
 * applyArrivalStep needs for the `step.kind === 'effect'` case. Returns false
 * for an `effectId` outside `ArrivalEffectId` (should never happen — every
 * effectId a planned itinerary carries comes from this file's own union) or
 * when the dispatched handler itself reports failure (fragment gone, storage
 * full, etc.) — mirroring `applyArrivalStep`'s own false-on-failure contract
 * for `board`.
 */
export function applyArrivalEffect(
  state: GameState,
  vehicle: Vehicle,
  effectId: string,
  emitter?: EventEmitter,
): boolean {
  if (effectId !== 'haul_load' && effectId !== 'haul_unload' && effectId !== 'boulder_split') return false;
  return ARRIVAL_EFFECTS[effectId](state, vehicle, emitter);
}
