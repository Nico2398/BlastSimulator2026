/** Self-dispatched `repair_vehicle` orders for idle damaged vehicles. */
import type { GameState, PendingAction } from '../state/GameState.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { getVehicleReservation } from '../entities/Vehicle.js';
import { isRepairable } from '../entities/VehicleRepair.js';
import { dispatchPendingAction, cancelAction } from '../engine/TaskDispatch.js';
import { REPAIR_BASE_TICKS_PER_HP } from '../config/balance.js';
import { getVehicleDefByTier } from '../entities/Vehicle.js';

/** Payload carried by a repair_vehicle PendingAction. */
interface RepairActionPayload {
  vehicleId: number;
  /** Base ticks at proficiency 1; scaled per employee by computeActionWorkTicks. */
  durationTicks: number;
}

/** A damaged vehicle nobody is sitting in and no order has reserved. */
function isIdleRepairable(state: GameState, v: Vehicle): boolean {
  return isRepairable(v)
    && v.occupantIds.length === 0
    && getVehicleReservation(state.vehicles, v.id) === null;
}

function repairBaseTicks(v: Vehicle): number {
  const missing = getVehicleDefByTier(v.type, v.tier).maxHp - v.hp;
  return Math.max(1, Math.ceil(missing * REPAIR_BASE_TICKS_PER_HP));
}

function repairTargetId(action: PendingAction): number | null {
  if (action.type !== 'repair_vehicle') return null;
  const id = action.payload['vehicleId'];
  return typeof id === 'number' ? id : null;
}

/**
 * Idempotent: one `repair_vehicle` PendingAction per idle damaged vehicle,
 * stale ones pruned. Orders skip the qualification check so unqualified
 * ones sit queued with blockedReason 'no_qualified_employee'.
 */
export function syncRepairDispatch(state: GameState): void {
  const vehicleById = new Map(state.vehicles.vehicles.map(v => [v.id, v]));
  const covered = new Set<number>();

  for (const action of [...state.pendingActions]) {
    const vehicleId = repairTargetId(action);
    if (vehicleId === null) continue;
    covered.add(vehicleId);
    if (action.status !== 'queued') continue;
    const v = vehicleById.get(vehicleId);
    if (v === undefined || !isIdleRepairable(state, v)) {
      cancelAction(state, action.id);
      covered.delete(vehicleId);
    }
  }

  for (const v of state.vehicles.vehicles) {
    if (covered.has(v.id) || !isIdleRepairable(state, v)) continue;
    dispatchPendingAction(state, {
      id: state.nextPendingActionId++,
      type: 'repair_vehicle',
      requiredSkill: 'repair',
      requiredVehicleRole: null,
      targetX: Math.round(v.x),
      targetZ: Math.round(v.z),
      targetY: 0,
      payload: { vehicleId: v.id, durationTicks: repairBaseTicks(v) } satisfies RepairActionPayload,
      targetEmployeeId: null,
    }, { skipQualificationCheck: true });
  }
}
