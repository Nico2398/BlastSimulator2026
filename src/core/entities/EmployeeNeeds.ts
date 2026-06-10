// BlastSimulator2026 — Need-meter logic for employees.
// Tracks three need gauges: hunger, fatigue, and breakNeed (all 0–100).

import { type Employee } from './Employee.js';
import { NEED_DRAIN_RATES, NEED_THRESHOLDS, NEED_PRODUCTIVITY_MULTIPLIERS, NEED_MORALE_PENALTIES } from '../config/balance.js';

/** The three need gauges tracked on every Employee. */
export type NeedKey = 'hunger' | 'fatigue' | 'breakNeed';

/**
 * Drain all need gauges by one tick.
 *
 * Hunger and fatigue drain faster while working than while idle.
 * breakNeed drains while working but does not drain while idle — employees
 * recover breakNeed automatically when not working.
 *
 * All gauges are clamped to a minimum of 0.
 */
export function tickNeeds(employee: Employee, isWorking: boolean): void {
  employee.hunger    = Math.max(0, employee.hunger    - (isWorking ? NEED_DRAIN_RATES.hunger.working    : NEED_DRAIN_RATES.hunger.idle));
  employee.fatigue   = Math.max(0, employee.fatigue   - (isWorking ? NEED_DRAIN_RATES.fatigue.working   : NEED_DRAIN_RATES.fatigue.idle));
  employee.breakNeed = Math.max(0, employee.breakNeed - (isWorking ? NEED_DRAIN_RATES.breakNeed.working : NEED_DRAIN_RATES.breakNeed.idle));
}

/**
 * Returns a productivity multiplier (0.0–1.0) based on hunger and fatigue levels.
 *
 * Each gauge independently applies a tier penalty once it falls below a threshold:
 *   - Hunger  < low      → ×0.80 | < critical → ×0.60
 *   - Fatigue < low      → ×0.75 | < critical → ×0.50
 *
 * Penalties are multiplicative: a hungry and exhausted worker suffers both.
 * Social and comfort do not affect productivity (they affect morale — see tickNeedMorale).
 */
export function getNeedMultiplier(employee: Employee): number {
  const hungerMult  = employee.hunger  < NEED_THRESHOLDS.hunger.critical  ? NEED_PRODUCTIVITY_MULTIPLIERS.hunger.critical
                    : employee.hunger  < NEED_THRESHOLDS.hunger.low        ? NEED_PRODUCTIVITY_MULTIPLIERS.hunger.low
                    : 1.0;
  const fatigueMult = employee.fatigue < NEED_THRESHOLDS.fatigue.critical ? NEED_PRODUCTIVITY_MULTIPLIERS.fatigue.critical
                    : employee.fatigue < NEED_THRESHOLDS.fatigue.low       ? NEED_PRODUCTIVITY_MULTIPLIERS.fatigue.low
                    : 1.0;
  return hungerMult * fatigueMult;
}

/**
 * Returns the morale delta (≤ 0) caused by unmet breakNeed.
 *
 * Call each tick and apply the returned value to employee.morale:
 *   - breakNeed < low → −2/tick
 */
export function tickNeedMorale(employee: Employee): number {
  let delta = 0;
  if (employee.breakNeed < NEED_THRESHOLDS.breakNeed.low) delta += NEED_MORALE_PENALTIES.breakNeed;
  return delta;
}

/**
 * Restore a single need gauge by `amount`, capped at 100.
 * Use when the employee eats, rests, or takes a break.
 */
export function replenishNeed(employee: Employee, need: NeedKey, amount: number): void {
  employee[need] = Math.min(100, employee[need] + amount);
}
