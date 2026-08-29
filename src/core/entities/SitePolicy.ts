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
  /**
   * Optional (#867) — most callers care only about hunger/fatigue, and this
   * type predates breakNeed's own inclusion here. Omitted is treated as 100
   * (fully rested), so a caller that never sets it never trips the
   * breakNeed/social check below; the real tick path (ForceShiftRest.ts)
   * always supplies the employee's actual gauge.
   */
  breakNeed?: number;
  ticksWorked: number;
};

/**
 * Returns true when the policy requires the employee to stop working and rest.
 *
 * Rules (evaluated in order):
 *  1. If !isWorking → false (already resting, nothing to force).
 *  2. For shift_8h / shift_12h → true if ticksWorked >= shift duration ticks.
 *  3. For all modes → true if hunger, fatigue, or breakNeed are at or below their
 *     rest thresholds (breakNeed against socialBreakThreshold — #867: this gauge
 *     was previously never checked here at all, see below). In 'custom' mode,
 *     per-employee overrides (customThresholds[id]) take precedence over the
 *     policy-level defaults when present.
 *  4. Otherwise → false.
 *
 * #867: breakNeed was completely unprotected by any site policy, including
 * this file's own 'continuous' mode — despite SitePolicy.socialBreakThreshold
 * (and customThresholds[id].social) existing, defaulting sensibly, and being
 * genuinely settable via `set_policy ... social:N` (console/commands/policy.ts)
 * since the type was first written. Nothing ever read the value back: this
 * function checked only hunger/fatigue. breakNeed drains only while working
 * (NEED_DRAIN_RATES.breakNeed.working, no idle drain at all) with no
 * proactive routing under any policy, so on a work-heavy crew it free-fell,
 * uninterrupted, all the way to its COLLAPSE threshold (15, well inside
 * needsMoraleEffect's "suffering"/-1.5-per-tick band, EmployeeNeeds.ts) before
 * anything intervened — and even then, a collapse rest services only the one
 * gauge that collapsed, topping breakNeed back up to roughly 45 (still short
 * of the 50 "comfortable" line), never the healthy margin hunger/fatigue's
 * own 60 default keeps them at. Confirmed as the dominant contributor to
 * `scripts/scenario-defs/vibration-budget.json`'s long-standing
 * `worker_revolt` (issue #867): a multi-employee, work-heavy, multi-thousand-
 * tick file grinds combined crew morale to 0 well within REVOLT_TICKS purely
 * from this one permanently-unaddressed gauge, independent of how well
 * hunger/fatigue are otherwise protected.
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
  const { hunger: hungerThreshold, fatigue: fatigueThreshold, social: socialThreshold } = getEffectiveThresholds(policy, employee.id);

  // Need-based rest check — breakNeed included alongside hunger/fatigue (#867).
  if (employee.hunger <= hungerThreshold || employee.fatigue <= fatigueThreshold
      || (employee.breakNeed ?? 100) <= socialThreshold) {
    return true;
  }

  return false;
}

/**
 * Returns the effective hunger/fatigue/social (breakNeed) rest thresholds for
 * an employee under this policy — per-employee `customThresholds` override
 * (in 'custom' mode) take precedence over the policy-level defaults when
 * present. `social` names the breakNeed threshold, matching customThresholds'
 * and socialBreakThreshold's own field name (#867).
 */
export function getEffectiveThresholds(policy: SitePolicy, employeeId?: number): { hunger: number; fatigue: number; social: number } {
  let hungerThreshold = policy.hungerRestThreshold;
  let fatigueThreshold = policy.fatigueRestThreshold;
  let socialThreshold = policy.socialBreakThreshold;

  if (policy.shiftMode === 'custom' && employeeId !== undefined) {
    const override = policy.customThresholds[employeeId];
    if (override !== undefined) {
      hungerThreshold = override.hunger;
      fatigueThreshold = override.fatigue;
      socialThreshold = override.social;
    }
  }

  return { hunger: hungerThreshold, fatigue: fatigueThreshold, social: socialThreshold };
}
