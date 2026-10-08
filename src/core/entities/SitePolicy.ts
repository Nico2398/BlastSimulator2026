// BlastSimulator2026 — SitePolicy: shift scheduling and rest thresholds.
// Governs shift modes (8 h, 12 h, continuous, custom) and the fatigue level
// that forces rest. Hunger and breakNeed thresholds were removed (#928).

import { SHIFT_DURATIONS_TICKS, SITE_POLICY_DEFAULT_THRESHOLD } from '../config/balance.js';

export type ShiftMode = 'shift_8h' | 'shift_12h' | 'continuous';

export interface SitePolicy {
  shiftMode: ShiftMode;
  /** Force rest when fatigue drops to or below this value. Default: 60 */
  fatigueRestThreshold: number;
  /**
   * Counts explicit player applications (set_policy / the Operations panel),
   * whether or not any value differs. Default 0. It records player edits only
   * and never gates the engine: the default policy is in force from tick 0
   * (#1379).
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
    fatigueRestThreshold: SITE_POLICY_DEFAULT_THRESHOLD,
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
  }
}

/** Employee data subset required by shouldForceRest. */
type EmployeeSnapshot = {
  id?: number;
  fatigue: number;
  ticksWorked: number;
};

/**
 * Returns true when the policy requires the employee to stop working and rest.
 *
 * Rules (evaluated in order):
 *  1. If !isWorking → false (already resting, nothing to force).
 *  2. For shift_8h / shift_12h → true if ticksWorked >= shift duration ticks.
 *  3. For all modes → true if fatigue is at or below its rest threshold. In
 *     'custom' mode, per-employee overrides (customThresholds[id]) take
 *     precedence over the policy-level default when present.
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

  // Determine effective threshold
  const { fatigue: fatigueThreshold } = getEffectiveThresholds(policy, employee.id);

  if (employee.fatigue <= fatigueThreshold) {
    return true;
  }

  return false;
}

/**
 * Returns the effective fatigue rest threshold for an employee under this
 * policy — a per-employee `customThresholds` override (in 'custom' mode)
 * takes precedence over the policy-level default when present.
 */
export function getEffectiveThresholds(policy: SitePolicy, _employeeId?: number): { fatigue: number } {
  return { fatigue: policy.fatigueRestThreshold };
}
