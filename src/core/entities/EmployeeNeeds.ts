// BlastSimulator2026 — Need-meter logic for employees.
// Tracks four need gauges: hunger, fatigue, social, and comfort (all 0–100).

import { type Employee } from './Employee.js';
import { NEED_DRAIN_RATES, NEED_THRESHOLDS, NEED_PRODUCTIVITY_MULTIPLIERS, NEED_MORALE_PENALTIES } from '../config/balance.js';

/** The four need gauges tracked on every Employee. */
export type NeedKey = 'hunger' | 'fatigue' | 'social' | 'comfort';

/**
 * Drain all need gauges by one tick.
 *
 * Hunger and fatigue drain faster while working than while idle.
 * Social and comfort drain at a fixed rate regardless of work status — their
 * working and idle rates in NEED_DRAIN_RATES are intentionally equal, reflecting
 * that these needs recover only through dedicated rest/social activities, not
 * simply by being at or away from work.
 *
 * All gauges are clamped to a minimum of 0.
 */
export function tickNeeds(employee: Employee, isWorking: boolean): void {
  employee.hunger  = Math.max(0, employee.hunger  - (isWorking ? NEED_DRAIN_RATES.hunger.working  : NEED_DRAIN_RATES.hunger.idle));
  employee.fatigue = Math.max(0, employee.fatigue - (isWorking ? NEED_DRAIN_RATES.fatigue.working : NEED_DRAIN_RATES.fatigue.idle));
  employee.social  = Math.max(0, employee.social  - NEED_DRAIN_RATES.social.idle);
  employee.comfort = Math.max(0, employee.comfort - NEED_DRAIN_RATES.comfort.idle);
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
 * Returns the morale delta (≤ 0) caused by unmet social and comfort needs.
 *
 * Call each tick and apply the returned value to employee.morale:
 *   - social  < low → −2/tick
 *   - comfort < low → −1/tick
 *
 * Both penalties stack when both needs are low (max combined: −3/tick).
 */
export function tickNeedMorale(employee: Employee): number {
  let delta = 0;
  if (employee.social  < NEED_THRESHOLDS.social.low)  delta += NEED_MORALE_PENALTIES.social;
  if (employee.comfort < NEED_THRESHOLDS.comfort.low) delta += NEED_MORALE_PENALTIES.comfort;
  return delta;
}

/**
 * Restore a single need gauge by `amount`, capped at 100.
 * Use when the employee eats, rests, socialises, or improves working conditions.
 */
export function replenishNeed(employee: Employee, need: NeedKey, amount: number): void {
  employee[need] = Math.min(100, employee[need] + amount);
}
