// BlastSimulator2026 — Vehicle status derivation (redesign P6, #1138)
// What a vehicle is doing right now, read off its occupant's own movement/
// task fields (Vehicle itself carries no display state any more) in the
// same priority a player needs to see it: stuck and waiting are call-to-
// action states, hauling is the common case worth naming specifically, and
// everything else falls back to the role's arrival task. Locale-agnostic:
// returns a kind + raw data, never player-facing text — mirrors
// EmployeeActivity.ts.

import type { Vehicle, VehicleTask, VehicleState } from './Vehicle.js';
import { getVehicleReservation } from './Vehicle.js';
import type { Employee } from './Employee.js';
import { VEHICLE_ROLE_ARRIVAL_TASK } from '../config/balance.js';

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
 * A stuck or waiting occupant takes priority over hauling — a stuck or
 * waiting vehicle is still nominally "hauling" by task, but a player needs
 * the call-to-action, not the routine label it would otherwise carry.
 * `broken` (destroyed by a projectile, mid-repair — `v.hp <= 0`) pre-empts
 * all of them: a broken vehicle isn't stuck in traffic, it isn't moving
 * anywhere.
 *
 * A debris_hauler reserved for an action (#1091 — the only action type this
 * role is ever claimed for is haul_debris) is "hauling" for its whole
 * itinerary, whichever leg it's currently on — `payload` is what
 * distinguishes the two sub-phases now that there is no separate
 * `haulingPhase` field on `Vehicle`: not yet loaded (still driving to the
 * fragment) vs. already loaded (driving to the depot). `vehicleState` is
 * needed for this branch's `getVehicleReservation` lookup (#1138 — the
 * reservation moved off `Vehicle` itself and onto `VehicleState.reservations`).
 *
 * `occupant`, optional (#1092, and required for anything but `broken`/`idle`
 * since #1138): the employee actually sitting in the vehicle. A vehicle is a
 * tool its occupant works and drives (`gameplay-vehicle-fleet`) — every
 * status but `broken` is now read off the occupant's own fields
 * (`isMoveStuck`, `vehicleWaitingTicks`, `taskTicksRemaining`, `itinerary`)
 * rather than off any vehicle-native display state, since `Vehicle` no
 * longer carries any (#1138 removed the last of it: `task`/`state`/
 * `waitingTicks`/`isMoveStuck`). With no occupant supplied (an empty
 * vehicle, or a caller that has not resolved one), nothing but `broken` can
 * be derived — the vehicle reads `idle`.
 */
export function computeVehicleStatus(v: Vehicle, vehicleState: VehicleState, occupant?: Employee): VehicleStatus {
  if (v.hp <= 0) return { ...IDLE, kind: 'broken' };
  if (occupant === undefined) return IDLE;

  if (occupant.isMoveStuck) return { ...IDLE, kind: 'stuck', ticks: occupant.moveConsecutiveFailures };
  if (occupant.vehicleWaitingTicks > 0) return { ...IDLE, kind: 'waiting', ticks: occupant.vehicleWaitingTicks };
  if (v.type === 'debris_hauler' && getVehicleReservation(vehicleState, v.id) !== null) {
    return { ...IDLE, kind: 'hauling', haulingPhase: v.payload !== null ? 'to_depot' : 'to_fragment' };
  }

  if (occupant.taskTicksRemaining !== null) return { ...IDLE, kind: 'working', task: VEHICLE_ROLE_ARRIVAL_TASK[v.type] };
  if (occupant.itinerary !== null) return { ...IDLE, kind: 'moving' };
  return IDLE;
}
