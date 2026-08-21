// BlastSimulator2026 — SitePolicy: shift scheduling and rest thresholds.
// Governs shift modes (8 h, 12 h, continuous, custom) and the need levels that force rest.

import { SHIFT_DURATIONS_TICKS, SITE_POLICY_DEFAULT_THRESHOLDS } from '../config/balance.js';

export type ShiftMode = 'shift_8h' | 'shift_12h' | 'continuous' | 'custom';

export interface SitePolicy {
  shiftMode: ShiftMode;
  /** Force rest when hunger drops to or below this value. Default: 60 */
  hungerRestThreshold: number;
  /** Force rest when fatigue drops to or below this value. Default: 60 */
  fatigueRestThreshold: number;
  /** Trigger a social break when social drops to or below this value. Default: 20 */
  socialBreakThreshold: number;
  /** Per-employee threshold overrides keyed by employee ID. */
  customThresholds: Record<number, { hunger: number; fatigue: number; social: number }>;
  /**
   * Bumped every time a policy is applied, whether or not any value differs.
   *
   * "Has the player set a policy?" cannot be answered by comparing values:
   * applying the policy already in force changes nothing, so anything watching
   * for a difference concludes nothing happened and waits forever.
   */
  revision: number;
}

/** Create a SitePolicy with sensible defaults. */
export function createSitePolicy(mode: ShiftMode = 'shift_8h'): SitePolicy {
  return {
    shiftMode: mode,
    hungerRestThreshold: SITE_POLICY_DEFAULT_THRESHOLDS.hungerRest,
    fatigueRestThreshold: SITE_POLICY_DEFAULT_THRESHOLDS.fatigueRest,
    socialBreakThreshold: SITE_POLICY_DEFAULT_THRESHOLDS.socialBreak,
    customThresholds: {},
    revision: 0,
  };
}

/**
 * Returns the number of ticks in a shift for the given mode.
 * continuous and custom have no enforced tick limit (Infinity).
 */
export function getShiftDurationTicks(mode: ShiftMode): number {
  switch (mode) {
    case 'shift_8h':  return SHIFT_DURATIONS_TICKS.shift_8h;
    case 'shift_12h': return SHIFT_DURATIONS_TICKS.shift_12h;
    case 'continuous': return Infinity;
    case 'custom':     return Infinity;
  }
}

/** Employee data subset required by shouldForceRest. */
type EmployeeSnapshot = {
  id?: number;
  hunger: number;
  fatigue: number;
  ticksWorked: number;
};

/**
 * Returns true when the policy requires the employee to stop working and rest.
 *
 * Rules (evaluated in order):
 *  1. If !isWorking → false (already resting, nothing to force).
 *  2. For shift_8h / shift_12h → true if ticksWorked >= shift duration ticks.
 *  3. For all modes → true if hunger or fatigue are at or below their rest thresholds.
 *     In 'custom' mode, per-employee overrides (customThresholds[id]) take precedence
 *     over the policy-level defaults when present.
 *  4. Otherwise → false.
 */
export function shouldForceRest(
  policy: SitePolicy,
  employee: EmployeeSnapshot,
  isWorking: boolean,
): boolean {
  if (!isWorking) return false;

  // Shift-duration check (only for timed modes)
  const shiftTicks = getShiftDurationTicks(policy.shiftMode);
  if (isFinite(shiftTicks) && employee.ticksWorked >= shiftTicks) {
    return true;
  }

  // Determine effective thresholds
  const { hunger: hungerThreshold, fatigue: fatigueThreshold } = getEffectiveThresholds(policy, employee.id);

  // Need-based rest check
  if (employee.hunger <= hungerThreshold || employee.fatigue <= fatigueThreshold) {
    return true;
  }

  return false;
}

/**
 * Returns the effective hunger/fatigue rest thresholds for an employee under
 * this policy — per-employee `customThresholds` override (in 'custom' mode)
 * take precedence over the policy-level defaults when present.
 */
export function getEffectiveThresholds(policy: SitePolicy, employeeId?: number): { hunger: number; fatigue: number } {
  let hungerThreshold = policy.hungerRestThreshold;
  let fatigueThreshold = policy.fatigueRestThreshold;

  if (policy.shiftMode === 'custom' && employeeId !== undefined) {
    const override = policy.customThresholds[employeeId];
    if (override !== undefined) {
      hungerThreshold = override.hunger;
      fatigueThreshold = override.fatigue;
    }
  }

  return { hunger: hungerThreshold, fatigue: fatigueThreshold };
}
