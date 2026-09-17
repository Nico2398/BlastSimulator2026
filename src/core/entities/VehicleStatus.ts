// BlastSimulator2026 — Vehicle status derivation (redesign P6)
// What a vehicle is doing right now, read off its own state/task fields in
// the same priority a player needs to see it: stuck and waiting are call-to-
// action states, hauling is the common case worth naming specifically, and
// everything else falls back to the raw task. Locale-agnostic: returns a
// kind + raw data, never player-facing text — mirrors EmployeeActivity.ts.

import type { Vehicle, VehicleTask } from './Vehicle.js';
import type { Employee } from './Employee.js';

export type VehicleStatusKind = 'broken' | 'stuck' | 'waiting' | 'hauling' | 'working' | 'moving' | 'idle';

export interface VehicleStatus {
  kind: VehicleStatusKind;
  /** Consecutive ticks spent stuck or waiting, set only for those two kinds. */
  ticks: number | null;
  /** Which leg of the haul, set only for 'hauling'. */
  haulingPhase: 'to_fragment' | 'to_depot' | null;
  /** The vehicle's own task label, set only for 'working' (drilling/loading/clearing). */
  task: VehicleTask | null;
}

const IDLE: VehicleStatus = { kind: 'idle', ticks: null, haulingPhase: null, task: null };

/**
 * `isMoveStuck` and `state === 'waiting'` both take priority over hauling —
 * a stuck or waiting vehicle is still nominally "hauling" by task, but a
 * player needs the call-to-action, not the routine label it would otherwise
 * carry. `broken` (destroyed by a projectile, mid-repair) pre-empts all of
 * them: a broken vehicle isn't stuck in traffic, it isn't moving anywhere.
 *
 * A debris_hauler reserved for an action (#1091 — the only action type this
 * role is ever claimed for is haul_debris) is "hauling" for its whole
 * itinerary, whichever leg it's currently on — `payload` is what
 * distinguishes the two sub-phases now that there is no separate
 * `haulingPhase` field on `Vehicle`: not yet loaded (still driving to the
 * fragment) vs. already loaded (driving to the depot).
 *
 * `occupant`, optional (#1092): the employee actually sitting in the vehicle.
 * A vehicle is a tool its occupant works and drives (`gameplay-vehicle-fleet`)
 * — so when the caller has that occupant in hand, "working" and "moving" are
 * read off them (a running work timer; an itinerary still being walked)
 * rather than off the vehicle's own display fields, which only the locomotion
 * tick writes and which therefore lag whatever the driver has just been
 * re-planned onto. `broken`/`stuck`/`waiting`/`hauling` stay vehicle-native:
 * they describe the machine, not whoever is in it. With no occupant supplied
 * (an empty vehicle, or a caller that has not resolved one) the derivation
 * is unchanged.
 */
export function computeVehicleStatus(v: Vehicle, occupant?: Employee): VehicleStatus {
  if (v.state === 'broken') return { ...IDLE, kind: 'broken' };
  if (v.isMoveStuck) return { ...IDLE, kind: 'stuck', ticks: v.waitingTicks };
  if (v.state === 'waiting') return { ...IDLE, kind: 'waiting', ticks: v.waitingTicks };
  if (v.type === 'debris_hauler' && v.reservedForActionId !== null) {
    return { ...IDLE, kind: 'hauling', haulingPhase: v.payload !== null ? 'to_depot' : 'to_fragment' };
  }

  if (occupant !== undefined) {
    if (occupant.taskTicksRemaining !== null) return { ...IDLE, kind: 'working', task: v.task };
    if (occupant.itinerary !== null) return { ...IDLE, kind: 'moving' };
    return IDLE;
  }

  if (v.state === 'working') return { ...IDLE, kind: 'working', task: v.task };
  if (v.state === 'moving') return { ...IDLE, kind: 'moving' };
  return IDLE;
}
