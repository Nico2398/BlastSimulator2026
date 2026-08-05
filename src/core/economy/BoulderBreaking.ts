// BlastSimulator2026 — Boulder breaking task
//
// Position-gated in-place breaking of an oversized fragment: a
// rock_fragmenter vehicle is dispatched to a boulder, breaks it only on
// arrival, replacing it in logistics with its sub-fragments. Mirrors
// HaulingTask.ts's shape (eligibility gate, request, per-tick progress,
// reachable-target lookup) for the break workflow instead of the haul one.
// ArrivalGate.ts drives the phase transitions.

import type { GameState } from '../state/GameState.js';
import type { Vehicle } from '../entities/Vehicle.js';
import type { FragmentData } from '../mining/BlastExecution.js';
import { isOversized, fragmentBoulder, type Boulder } from '../mining/BlastCalc.js';
import { fragmentApproachCell } from './FragmentApproach.js';
import { findRequestVehicle, driveTowardFragment, findNearestReachableFragment } from './FragmentTaskLifecycle.js';
import { tickVehicleTaskState } from '../engine/EntityMovementTick.js';
import { Random } from '../math/Random.js';
import { scale, vec3, ZERO } from '../math/Vec3.js';

/**
 * True when `vehicle` is a rock_fragmenter with a driver assigned and no
 * break task already in progress — the shared eligibility gate for
 * findReachableOversizedFragment and the UI's Break button.
 */
export function isBreakEligibleVehicle(vehicle: Vehicle | undefined): vehicle is Vehicle {
  return !!vehicle && vehicle.type === 'rock_fragmenter' && vehicle.driverId !== null && vehicle.breakPhase === null;
}

/**
 * Request that a rock_fragmenter vehicle break an oversized fragment in
 * place. Sets the vehicle's break intent (fragmentId, phase) without moving
 * or breaking it immediately — ArrivalGate.tickArrivalGate and
 * tickBreakProgress drive the phases.
 */
export function requestBreakBoulder(
  state: GameState,
  vehicleId: number,
  fragmentId: number,
): { success: boolean; error?: string } {
  const found = findRequestVehicle(state, vehicleId);
  if (!found.success) return found;
  const vehicle = found.vehicle;
  if (vehicle.type !== 'rock_fragmenter') return { success: false, error: 'Vehicle is not a rock fragmenter' };
  if (vehicle.driverId === null) return { success: false, error: 'Vehicle has no driver' };
  if (vehicle.breakPhase !== null) return { success: false, error: 'Vehicle is already breaking a fragment' };

  const tracked = state.logistics.fragments.find(
    f => f.fragment.id === fragmentId && f.state === 'on_ground',
  );
  if (!tracked) return { success: false, error: 'Fragment not found or not on the ground' };
  if (!isOversized(tracked.fragment.volume)) return { success: false, error: 'Fragment is not oversized' };

  // Intent only — the vehicle does not split the boulder until
  // tickBreakProgress (driven from ArrivalGate.tickArrivalGate) detects
  // arrival. The movement target is set immediately so tickVehicle has
  // somewhere to drive toward each tick.
  const approach = fragmentApproachCell(tracked.fragment, state, vehicle.id);
  vehicle.breakFragmentId = fragmentId;
  vehicle.breakPhase = 'to_boulder';
  vehicle.task = 'moving';
  vehicle.targetX = approach.x;
  vehicle.targetZ = approach.z;

  return { success: true };
}

/**
 * Advance a single vehicle's in-progress break task by one tick: moves it
 * toward the boulder, and on arrival splits it via fragmentBoulder, removing
 * the original fragment from logistics and inserting each sub-fragment as a
 * new on-ground fragment. Returns the original fragment's id on the tick it
 * split, otherwise null (still travelling / aborted / no-op).
 */
export function tickBreakProgress(state: GameState, vehicle: Vehicle): number | null {
  if (vehicle.breakPhase === null) return null;

  const tracked = state.logistics.fragments.find(
    f => f.fragment.id === vehicle.breakFragmentId && f.state === 'on_ground',
  );
  if (!tracked) {
    // Fragment gone (broken/removed elsewhere) — abandon this break.
    abortBreak(vehicle);
    return null;
  }

  const arrived = driveTowardFragment(state, vehicle, tracked.fragment);
  if (!arrived) {
    tickVehicleTaskState(vehicle);
    return null;
  }

  const boulder: Boulder = {
    id: tracked.fragment.id,
    volume: tracked.fragment.volume,
    mass: tracked.fragment.mass,
    rockId: tracked.fragment.rockId,
    oreDensities: tracked.fragment.oreDensities,
  };
  const rng = new Random(breakSeed(tracked.fragment.id, state.tickCount));
  const result = fragmentBoulder(boulder, rng);
  if (!result.success) {
    // Shouldn't happen (volume can't shrink between request and arrival),
    // but never leave the vehicle stuck mid-break on an unexpected reject.
    abortBreak(vehicle);
    return null;
  }

  const originalId = tracked.fragment.id;
  // Computed before the splice below (and against the original fragment's own
  // id) so a sub-fragment id can never collide with the boulder just removed
  // or with any other fragment still tracked in logistics — computing this
  // after the splice would let ids restart low and collide with unrelated
  // on_ground fragments in a large field.
  let nextId = Math.max(highestFragmentId(state), originalId) + 1;
  const idx = state.logistics.fragments.indexOf(tracked);
  if (idx >= 0) state.logistics.fragments.splice(idx, 1);

  // Fixture/parent fragments built by hand (e.g. in tests) may omit
  // halfExtents even though FragmentData declares it required — fall back to
  // a cube approximation from the parent's own volume rather than crash.
  const parentHalfExtents = tracked.fragment.halfExtents
    ?? vec3(Math.cbrt(boulder.volume) / 2, Math.cbrt(boulder.volume) / 2, Math.cbrt(boulder.volume) / 2);

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
  }

  abortBreak(vehicle);
  return originalId;
}

/**
 * Find a reachability-aware oversized fragment for `vehicleId` to break: the
 * nearest 'on_ground' oversized fragment that is actually path-connected to
 * the vehicle's current position. No storage-room check — breaking never
 * touches the warehouse, unlike hauling. Returns null when none qualify.
 */
export function findReachableOversizedFragment(state: GameState, vehicleId: number): number | null {
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (!isBreakEligibleVehicle(vehicle)) return null;

  return findNearestReachableFragment(
    state,
    vehicleId,
    vehicle.x,
    vehicle.z,
    tracked => isOversized(tracked.fragment.volume),
  );
}

/**
 * Deterministic seed for one boulder's split — same fragment id at the same
 * tick always breaks into the same shapeSeed sequence (FNV-1a-style mix,
 * matching BlastExecution.ts's fragmentSeedFor pattern).
 */
function breakSeed(fragmentId: number, tickCount: number): number {
  let seed = 2166136261;
  seed = Math.imul(seed ^ fragmentId, 16777619);
  seed = Math.imul(seed ^ tickCount, 16777619);
  return Math.abs(seed) % 2147483647;
}

/** Highest fragment id currently tracked in logistics, or -1 if none. */
function highestFragmentId(state: GameState): number {
  let max = -1;
  for (const f of state.logistics.fragments) {
    if (f.fragment.id > max) max = f.fragment.id;
  }
  return max;
}

/** Cancel an in-progress break and return the vehicle to idle. */
function abortBreak(vehicle: Vehicle): void {
  vehicle.breakFragmentId = null;
  vehicle.breakPhase = null;
  vehicle.task = 'idle';
}
