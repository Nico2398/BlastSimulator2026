/** Vehicle repair rules: which vehicles can be repaired, pace and parts cost. */
import type { Vehicle } from './Vehicle.js';

/** True when the vehicle is damaged but not wrecked (0 < hp < maxHp). */
export function isRepairable(_v: Vehicle): boolean {
  // TODO: implement
  return false;
}

/** Hp restored on one tick of a repair that has `ticksRemaining` ticks left. */
export function repairHpThisTick(_v: Vehicle, _ticksRemaining: number): number {
  // TODO: implement
  return 0;
}

/** Parts cost of restoring `hp` hit points. */
export function repairPartsCost(_hp: number): number {
  // TODO: implement
  return 0;
}
