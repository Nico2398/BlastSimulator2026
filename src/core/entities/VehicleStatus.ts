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
 * `occupant`, optional (#1092): the vehicle's driver, when the caller has it
 * in hand, for a future reposition-aware status line (e.g. distinguishing a
 * reposition drive from ordinary `moving`). Unused until the implementer
 * wires it in — every existing call site keeps working unchanged.
 */
export function computeVehicleStatus(v: Vehicle, _occupant?: Employee): VehicleStatus {
  if (v.state === 'broken') return { ...IDLE, kind: 'broken' };
  if (v.isMoveStuck) return { ...IDLE, kind: 'stuck', ticks: v.waitingTicks };
  if (v.state === 'waiting') return { ...IDLE, kind: 'waiting', ticks: v.waitingTicks };
  if (v.type === 'debris_hauler' && v.reservedForActionId !== null) {
    return { ...IDLE, kind: 'hauling', haulingPhase: v.payload !== null ? 'to_depot' : 'to_fragment' };
  }
  if (v.state === 'working') return { ...IDLE, kind: 'working', task: v.task };
  if (v.state === 'moving') return { ...IDLE, kind: 'moving' };
  return IDLE;
}
