// BlastSimulator2026 — Vehicle status derivation (redesign P6, #1138)
// What a vehicle is doing right now, read off its occupant's own movement/
// task fields (Vehicle itself carries no display state any more) in the
// same priority a player needs to see it: stuck and waiting are call-to-
// action states, hauling is the common case worth naming specifically, and
// everything else falls back to the role's arrival task. Locale-agnostic:
// returns a kind + raw data, never player-facing text — mirrors
// EmployeeActivity.ts.

import type { Vehicle, VehicleTask, VehicleState } from './Vehicle.js';
import { getVehicleReservation, getVehicleDefByTier } from './Vehicle.js';
import { octileHeuristic } from '../nav/Pathfinding.js';
import type { Employee } from './Employee.js';
import { VEHICLE_ROLE_ARRIVAL_TASK } from '../config/balance.js';
import type { ActionType, BlockedOrderReason, PendingAction } from '../state/GameState.js';
import type { Itinerary } from '../engine/Itinerary.js';

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
    return { ...IDLE, kind: 'hauling', haulingPhase: v.cargo.length > 0 ? 'to_depot' : 'to_fragment' };
  }

  if (occupant.taskTicksRemaining !== null) return { ...IDLE, kind: 'working', task: VEHICLE_ROLE_ARRIVAL_TASK[v.type] };
  if (occupant.itinerary !== null) return { ...IDLE, kind: 'moving' };
  return IDLE;
}

/** What a vehicle's job is aimed at (#1761). */
export type VehicleJobTarget =
  | { kind: 'fragment'; id: number }
  | { kind: 'hole'; id: string }
  | { kind: 'building' | 'vehicle'; id: number };

/** The job a vehicle is serving: action, target, destination and ETA (#1761). */
export interface VehicleJob {
  actionType: ActionType | null;
  target: VehicleJobTarget | null;
  destination: { x: number; z: number; buildingId: number | null } | null;
  etaTicks: number | null;
  blockedReason: BlockedOrderReason | null;
}

const NO_JOB: VehicleJob = { actionType: null, target: null, destination: null, etaTicks: null, blockedReason: null };

function jobTargetOf(action: PendingAction): VehicleJobTarget | null {
  const p = action.payload;
  if (typeof p['fragmentId'] === 'number') return { kind: 'fragment', id: p['fragmentId'] };
  if (typeof p['holeId'] === 'string') return { kind: 'hole', id: p['holeId'] };
  if (typeof p['buildingId'] === 'number') return { kind: 'building', id: p['buildingId'] };
  if (typeof p['vehicleId'] === 'number') return { kind: 'vehicle', id: p['vehicleId'] };
  return null;
}

/**
 * Job a vehicle currently serves, read off its reservation, occupant and pending actions.
 * Locale-free. `cargoWarehouseId` is the warehouse the loaded cargo is bound for; only a
 * loaded hauler names it as the destination building. A broken vehicle, or an idle one with
 * nothing queued for its role, has no job; an idle one with a queued order for its role
 * that is blocked carries the order's `blockedReason`.
 */
export function computeVehicleJob(
  v: Vehicle,
  vehicleState: VehicleState,
  pendingActions: readonly PendingAction[],
  occupant?: Employee,
  cargoWarehouseId?: number | null,
): VehicleJob {
  if (v.hp <= 0) return NO_JOB;
  const reservedId = getVehicleReservation(vehicleState, v.id);
  const action = reservedId === null ? undefined : pendingActions.find(a => a.id === reservedId);
  if (!action) {
    const blocked = pendingActions.find(a =>
      a.status === 'queued' && a.holderId === null && a.requiredVehicleRole === v.type && a.blockedReason != null);
    if (!blocked) return NO_JOB;
    return { ...NO_JOB, actionType: blocked.type, target: jobTargetOf(blocked), blockedReason: blocked.blockedReason ?? null };
  }

  const base = { actionType: action.type, target: jobTargetOf(action), blockedReason: null };
  if (occupant?.taskTicksRemaining != null) {
    return { ...base, destination: null, etaTicks: occupant.taskTicksRemaining };
  }
  const legs = occupant?.itinerary?.legs ?? [];
  const last = legs[legs.length - 1];
  const loaded = v.type === 'debris_hauler' && v.cargo.length > 0;
  const dest = last ? { x: last.destX, z: last.destZ } : { x: action.targetX, z: action.targetZ };
  return {
    ...base,
    destination: { ...dest, buildingId: loaded ? (cargoWarehouseId ?? null) : null },
    etaTicks: occupant?.itinerary ? vehicleEtaTicks(v, occupant.itinerary) : null,
  };
}

/**
 * Ticks left on an itinerary from the vehicle's current position (1 tick = 1 hour): the
 * octile distance to the first leg's destination at the tier's speed (rounded up), plus the
 * planned cost of the remaining legs. Shrinks as the vehicle closes on that destination.
 */
export function vehicleEtaTicks(v: Pick<Vehicle, 'x' | 'z' | 'type' | 'tier'>, itinerary: Itinerary): number {
  const [first, ...rest] = itinerary.legs;
  if (!first) return 0;
  const { speed } = getVehicleDefByTier(v.type, v.tier);
  const toFirst = speed > 0 ? Math.ceil(octileHeuristic(v.x, v.z, first.destX, first.destZ) / speed) : 0;
  return toFirst + rest.reduce((sum, leg) => sum + leg.estTicks, 0);
}
