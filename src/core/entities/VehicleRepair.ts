/** Vehicle repair rules: which vehicles can be repaired, pace and parts cost. */
import type { PendingAction } from '../state/GameState.js';
import { REPAIR_PARTS_COST_PER_HP } from '../config/balance.js';
import { getVehicleDefByTier, type Vehicle } from './Vehicle.js';

function missingHp(v: Vehicle): number {
  return Math.max(0, getVehicleDefByTier(v.type, v.tier).maxHp - v.hp);
}

/** True when the vehicle is damaged but not wrecked (0 < hp < maxHp). */
export function isRepairable(v: Vehicle): boolean {
  return v.hp > 0 && missingHp(v) > 0;
}

/**
 * Hp restored on one tick of a repair that has `ticksRemaining` ticks left
 * (this one included). Spreads the live missing hp evenly over the remaining
 * ticks, so an interrupted repair resumes with the right amount; the last
 * tick restores everything still missing. Never exceeds the missing hp.
 */
export function repairHpThisTick(v: Vehicle, ticksRemaining: number): number {
  const missing = missingHp(v);
  if (ticksRemaining <= 1) return missing;
  return Math.min(missing, Math.ceil(missing / ticksRemaining));
}

/** Parts cost of restoring `hp` hit points. */
export function repairPartsCost(hp: number): number {
  return hp * REPAIR_PARTS_COST_PER_HP;
}

/** True when a claimed (assigned / in-progress) repair order covers `vehicleId`. */
export function isVehicleUnderRepair(
  actions: ReadonlyArray<Pick<PendingAction, 'type' | 'status' | 'payload'>>,
  vehicleId: number,
): boolean {
  return actions.some(a =>
    a.type === 'repair_vehicle' && a.status !== 'queued' && a.payload['vehicleId'] === vehicleId,
  );
}
