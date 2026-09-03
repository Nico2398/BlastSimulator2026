// BlastSimulator2026 — Need-meter logic for employees.
// Tracks the single fatigue gauge (0–100). Hunger and breakNeed were removed
// (#928) — fatigue alone is the well-being lever the rest of the game reacts
// to (rest routing, morale, collapse).

import { type Employee } from './Employee.js';
import { NEED_DRAIN_RATES, NEED_THRESHOLDS, NEED_PRODUCTIVITY_MULTIPLIERS, MORALE_THRESHOLDS, NEED_MORALE_DRAIN_MULTIPLIERS, NEED_MORALE_EFFECT_THRESHOLDS, NEED_MORALE_EFFECT_PENALTIES, NEED_WELL_RESTED_THRESHOLD, NEED_WELL_RESTED_BONUS, BUILDING_REPLENISH_RATES, NEED_COLLAPSE_THRESHOLDS } from '../config/balance.js';

/** The single need gauge tracked on every Employee. */
export type NeedKey = 'fatigue';

/**
 * Work-state classification used to select the correct NEED_DRAIN_RATES tier
 * for {@link tickNeedGauges} (#680, extended to 'traveling' by #928).
 * - 'working': actively performing a task (drains fastest).
 * - 'idle': not working and not resting (e.g. routed toward a rest destination
 *   but not yet arrived).
 * - 'resting': actively resting (restTicksRemaining !== null).
 * - 'traveling': walking toward a claimed task or rest destination, not yet
 *   arrived (pendingTaskDuration or pendingRestDuration !== null).
 */
export type EmployeeWorkState = 'working' | 'idle' | 'resting' | 'traveling';

/**
 * Returns a productivity multiplier (0.0–1.0) based on fatigue level.
 *
 * Fatigue < low → ×0.75 | < critical → ×0.50
 */
export function getNeedMultiplier(employee: Employee): number {
  const fatigueMult = employee.fatigue < NEED_THRESHOLDS.fatigue.critical ? NEED_PRODUCTIVITY_MULTIPLIERS.fatigue.critical
                    : employee.fatigue < NEED_THRESHOLDS.fatigue.low       ? NEED_PRODUCTIVITY_MULTIPLIERS.fatigue.low
                    : 1.0;
  return fatigueMult;
}

/**
 * Pure function. Computes the tick-level morale delta from the fatigue gauge.
 *
 * The gauge contributes 0 (≥50), −0.5 (30–49), −1.5 (15–29), or −3.0 (<15).
 *
 * If fatigue is above {@link NEED_WELL_RESTED_THRESHOLD} (currently 80), a
 * well-rested bonus of +1 (NEED_WELL_RESTED_BONUS) is applied.
 *
 * This function does NOT mutate employee.morale — it returns a delta that the
 * caller must apply each tick.
 *
 * @returns The morale delta for this tick.
 */
export function needsMoraleEffect(employee: Employee): number {
  let delta = 0;

  const gauges: NeedKey[] = ['fatigue'];
  for (const gauge of gauges) {
    const value = employee[gauge];
    if (value >= NEED_MORALE_EFFECT_THRESHOLDS.comfortable) {
      delta += NEED_MORALE_EFFECT_PENALTIES.comfortable;
    } else if (value >= NEED_MORALE_EFFECT_THRESHOLDS.uncomfortable) {
      delta += NEED_MORALE_EFFECT_PENALTIES.uncomfortable;
    } else if (value >= NEED_MORALE_EFFECT_THRESHOLDS.suffering) {
      delta += NEED_MORALE_EFFECT_PENALTIES.suffering;
    } else {
      delta += NEED_MORALE_EFFECT_PENALTIES.critical;
    }
  }

  // Well-rested bonus: fatigue strictly above threshold.
  if (employee.fatigue > NEED_WELL_RESTED_THRESHOLD) {
    delta += NEED_WELL_RESTED_BONUS;
  }

  return delta;
}

/**
 * Restore a single need gauge using the replenishment rate for the given
 * building tier, subject to available capacity.
 *
 * @returns `true` if capacity was available and replenishment was attempted;
 *          `false` if capacity was insufficient.
 *
 * Currently has no production caller — completeRestForEmployee
 * (RestActionHelpers.ts, #945) switched rest completion to a direct
 * `emp[needKey] = MAX_NEED_GAUGE`/NEED_REST_NO_BUILDING_CAP assignment
 * instead of this per-tick, tier-rate-based path. Kept as tested public API
 * (own unit coverage still exercises it) in case a future per-tick
 * replenishment need reintroduces a caller.
 */
export function replenishNeed(
  employee: Employee,
  need: NeedKey,
  buildingTier: 1 | 2 | 3,
  availableCapacity: number,
): boolean {
  if (availableCapacity <= 0) return false;

  const rate = BUILDING_REPLENISH_RATES[need][buildingTier];
  employee[need] = Math.min(100, employee[need] + rate);
  return true;
}

/**
 * Internal helper. Returns a drain-rate multiplier based on employee morale.
 * - morale > 70: ×0.85 (slower drain — happier workers take better care)
 * - morale < 30: ×1.20 (faster drain — unhappy workers let themselves go)
 * - otherwise:   ×1.00 (standard drain)
 */
function getMoraleDrainMultiplier(morale: number): number {
  if (morale > MORALE_THRESHOLDS.high) return NEED_MORALE_DRAIN_MULTIPLIERS.high;
  if (morale < MORALE_THRESHOLDS.low) return NEED_MORALE_DRAIN_MULTIPLIERS.low;
  return NEED_MORALE_DRAIN_MULTIPLIERS.normal;
}

/**
 * Check whether an employee's need gauges have fallen to or below their
 * collapse thresholds. Sets collapsing=true and clears activeActionId on collapse.
 * @returns The NeedKey that caused the collapse, or null if no collapse.
 */
export function checkCollapse(employee: Employee): NeedKey | null {
  if (employee.collapsing) return null;

  const gauges: NeedKey[] = ['fatigue'];
  for (const gauge of gauges) {
    if (employee[gauge] <= NEED_COLLAPSE_THRESHOLDS[gauge]) {
      employee.collapsing = true;
      employee.activeActionId = null;
      return gauge;
    }
  }

  return null;
}

/**
 * Drain all need gauges by one tick, adjusted by a morale-based multiplier.
 *
 * High morale (>70) slows drain (×0.85), low morale (<30) accelerates drain (×1.20).
 * Call this each tick for each employee.
 * All gauges are clamped to a minimum of 0.
 *
 * @param workState Four-state work classification (#680, #928) selecting the
 *   NEED_DRAIN_RATES tier — 'working' | 'idle' | 'resting' | 'traveling'.
 */
export function tickNeedGauges(employee: Employee, workState: EmployeeWorkState): void {
  const multiplier = getMoraleDrainMultiplier(employee.morale);

  const gauges: NeedKey[] = ['fatigue'];
  for (const gauge of gauges) {
    const baseRate = NEED_DRAIN_RATES[gauge][workState];
    const actualDrain = baseRate * multiplier;
    employee[gauge] = Math.max(0, employee[gauge] - actualDrain);
  }
}
