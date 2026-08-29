/**
 * tests/unit/entities/SitePolicy.test.ts
 *
 * Task 3.12 — Red-phase tests for SitePolicy shift/rest scheduling.
 *
 * These tests WILL FAIL until src/core/entities/SitePolicy.ts is implemented.
 * Each test captures exactly one specific behaviour of the SitePolicy system.
 */

import { describe, it, expect } from 'vitest';
import {
  createSitePolicy,
  getShiftDurationTicks,
  shouldForceRest,
  // ── #678: getEffectiveThresholds — merges a policy's own thresholds over
  // the site defaults. Tests below cover it.
  getEffectiveThresholds,
  type ShiftMode,
  type SitePolicy,
} from '../../../src/core/entities/SitePolicy.js';
import { SHIFT_DURATIONS_TICKS } from '../../../src/core/config/balance.js';

// ─── createSitePolicy() ───────────────────────────────────────────────────────

describe('createSitePolicy() (3.12)', () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it("createSitePolicy('shift_8h') returns shiftMode 'shift_8h' with correct default thresholds", () => {
    const policy: SitePolicy = createSitePolicy('shift_8h');

    expect(policy.shiftMode).toBe('shift_8h');
    expect(policy.hungerRestThreshold).toBe(60);
    expect(policy.fatigueRestThreshold).toBe(60);
    expect(policy.socialBreakThreshold).toBe(20);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("createSitePolicy('continuous') returns shiftMode 'continuous'", () => {
    const policy: SitePolicy = createSitePolicy('continuous');

    expect(policy.shiftMode).toBe('continuous');
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('createSitePolicy() with no argument returns a valid policy with default shiftMode', () => {
    const policy: SitePolicy = createSitePolicy();

    // Must be one of the four valid shift modes
    const validModes: ShiftMode[] = ['shift_8h', 'shift_12h', 'continuous', 'custom'];
    expect(validModes).toContain(policy.shiftMode);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('createSitePolicy() initialises customThresholds as an empty record', () => {
    const policy: SitePolicy = createSitePolicy('custom');

    expect(policy.customThresholds).toBeDefined();
    expect(typeof policy.customThresholds).toBe('object');
    expect(Object.keys(policy.customThresholds)).toHaveLength(0);
  });
});

// ─── getShiftDurationTicks() ─────────────────────────────────────────────────

describe('getShiftDurationTicks() (3.12)', () => {
  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it("getShiftDurationTicks('shift_8h') returns 8 (matches SHIFT_DURATIONS_TICKS.shift_8h)", () => {
    const result = getShiftDurationTicks('shift_8h');

    expect(result).toBe(8);
    expect(result).toBe(SHIFT_DURATIONS_TICKS.shift_8h);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it("getShiftDurationTicks('shift_12h') returns 12 (matches SHIFT_DURATIONS_TICKS.shift_12h)", () => {
    const result = getShiftDurationTicks('shift_12h');

    expect(result).toBe(12);
    expect(result).toBe(SHIFT_DURATIONS_TICKS.shift_12h);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it("getShiftDurationTicks('continuous') returns Infinity — no enforced break", () => {
    const result = getShiftDurationTicks('continuous');

    expect(result).toBe(Infinity);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it("getShiftDurationTicks('custom') returns Infinity — player sets individual thresholds", () => {
    const result = getShiftDurationTicks('custom');

    expect(result).toBe(Infinity);
  });
});

// ─── shouldForceRest() — shift-duration logic ────────────────────────────────

describe('shouldForceRest() — shift-duration enforcement (3.12)', () => {
  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('returns true when ticksWorked equals the shift_8h shift duration', () => {
    const policy = createSitePolicy('shift_8h');
    // Employee is just above thresholds so only the shift boundary triggers rest
    const employee = { hunger: 80, fatigue: 80, ticksWorked: 8 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });

  // ── Test 10 ──────────────────────────────────────────────────────────────────
  it('returns true when ticksWorked exceeds the shift_8h shift duration', () => {
    const policy = createSitePolicy('shift_8h');
    const employee = { hunger: 80, fatigue: 80, ticksWorked: 10 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });

  // ── Test 11 ──────────────────────────────────────────────────────────────────
  it('returns false when ticksWorked is below the shift_8h shift duration and needs are healthy', () => {
    const policy = createSitePolicy('shift_8h');
    // ticksWorked=5 < 8, and hunger/fatigue well above thresholds
    const employee = { hunger: 80, fatigue: 80, ticksWorked: 5 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(false);
  });

  // ── Test 12 ──────────────────────────────────────────────────────────────────
  it('returns false for continuous mode regardless of how many ticks the employee has worked', () => {
    const policy = createSitePolicy('continuous');
    // Even with massive ticksWorked and healthy needs, continuous mode never forces shift rest
    const employee = { hunger: 80, fatigue: 80, ticksWorked: 9999 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(false);
  });

  // ── Test 13 ──────────────────────────────────────────────────────────────────
  it('returns false for shift_8h when the employee is not currently working', () => {
    const policy = createSitePolicy('shift_8h');
    // ticksWorked ≥ shift duration but employee is already resting
    const employee = { hunger: 80, fatigue: 80, ticksWorked: 8 };

    const result = shouldForceRest(policy, employee, false);

    expect(result).toBe(false);
  });
});

// ─── shouldForceRest() — need-threshold logic ───────────────────────────────

describe('shouldForceRest() — need-threshold enforcement (3.12)', () => {
  // ── Test 14 ──────────────────────────────────────────────────────────────────
  it('returns true when hunger drops below hungerRestThreshold even if shift is not over', () => {
    const policy = createSitePolicy('shift_8h');
    // hunger (30) < hungerRestThreshold (60); ticksWorked well below shift end
    const employee = { hunger: 30, fatigue: 80, ticksWorked: 2 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });

  // ── Test 15 ──────────────────────────────────────────────────────────────────
  it('returns true when fatigue drops below fatigueRestThreshold even if shift is not over', () => {
    const policy = createSitePolicy('shift_8h');
    // fatigue (20) < fatigueRestThreshold (60); ticksWorked well below shift end
    const employee = { hunger: 80, fatigue: 20, ticksWorked: 2 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });

  // ── Test 16 ──────────────────────────────────────────────────────────────────
  it('returns false when hunger and fatigue are above their thresholds and ticksWorked < shift duration', () => {
    const policy = createSitePolicy('shift_8h');
    // hunger (70) > 60, fatigue (70) > 60, ticksWorked (3) < 8 → no rest needed
    const employee = { hunger: 70, fatigue: 70, ticksWorked: 3 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(false);
  });

  // ── Test 17 ──────────────────────────────────────────────────────────────────
  it('returns true when hunger is exactly at the hungerRestThreshold (boundary condition)', () => {
    const policy = createSitePolicy('shift_8h');
    // hunger exactly equal to threshold — should trigger rest (hunger < threshold OR <= threshold)
    const employee = { hunger: policy.hungerRestThreshold, fatigue: 80, ticksWorked: 2 };

    // The boundary value itself is expected to trigger rest (hunger IS at threshold level)
    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });

  // ── Test 18 ──────────────────────────────────────────────────────────────────
  it('returns true when fatigue is exactly at the fatigueRestThreshold (boundary condition)', () => {
    const policy = createSitePolicy('shift_8h');
    const employee = { hunger: 80, fatigue: policy.fatigueRestThreshold, ticksWorked: 2 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });

  // ── Test 19 ──────────────────────────────────────────────────────────────────
  it('returns false when hunger and fatigue are each one point above their thresholds', () => {
    const policy = createSitePolicy('shift_8h');
    // hunger = 61 > 60, fatigue = 61 > 60 — just above thresholds; shift not over
    const employee = {
      hunger: policy.hungerRestThreshold + 1,
      fatigue: policy.fatigueRestThreshold + 1,
      ticksWorked: 3,
    };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(false);
  });
});

// ─── shouldForceRest() — custom per-employee threshold overrides ─────────────

describe("shouldForceRest() — 'custom' mode with per-employee overrides (3.12)", () => {
  // ── Test 20 ──────────────────────────────────────────────────────────────────
  it('uses per-employee hunger threshold when shiftMode is custom and an override exists for the employee id', () => {
    const policy: SitePolicy = createSitePolicy('custom');
    const employeeId = 7;
    // Give employee 7 a very high hunger threshold so hunger=60 still triggers rest
    policy.customThresholds[employeeId] = { hunger: 70, fatigue: 10, social: 10 };

    // hunger=60 is below the custom threshold of 70 → should force rest
    const employee = { id: employeeId, hunger: 60, fatigue: 80, ticksWorked: 1 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });

  // ── Test 21 ──────────────────────────────────────────────────────────────────
  it('uses per-employee fatigue threshold when shiftMode is custom and an override exists for the employee id', () => {
    const policy: SitePolicy = createSitePolicy('custom');
    const employeeId = 3;
    // Custom threshold: fatigue must stay above 50; fatigue=40 → trigger rest
    policy.customThresholds[employeeId] = { hunger: 10, fatigue: 50, social: 10 };

    const employee = { id: employeeId, hunger: 80, fatigue: 40, ticksWorked: 1 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });

  // ── Test 22 ──────────────────────────────────────────────────────────────────
  it('does NOT trigger rest when employee needs are above the custom thresholds', () => {
    const policy: SitePolicy = createSitePolicy('custom');
    const employeeId = 5;
    policy.customThresholds[employeeId] = { hunger: 30, fatigue: 20, social: 15 };

    // hunger=80, fatigue=80 — both above respective custom thresholds → no rest
    const employee = { id: employeeId, hunger: 80, fatigue: 80, ticksWorked: 1 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(false);
  });

  // ── Test 23 ──────────────────────────────────────────────────────────────────
  it('falls back to policy-level thresholds for an employee with no custom override in custom mode', () => {
    const policy: SitePolicy = createSitePolicy('custom');
    // Only override employee 99 — employee 1 has no override
    policy.customThresholds[99] = { hunger: 70, fatigue: 70, social: 70 };

    // Employee 1 should use the default policy thresholds (hunger < 60 → rest)
    const employee = { id: 1, hunger: 30, fatigue: 80, ticksWorked: 1 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });
});

// ─── getEffectiveThresholds() (#678) ─────────────────────────────────────────
//
// Extracted from shouldForceRest's own custom-mode override lookup so
// ForceShiftRest.ts's forced-rest-under-policy path (#678) can report which
// thresholds actually applied, not just a yes/no verdict.

describe('getEffectiveThresholds() (#678)', () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('returns the policy-level default thresholds for a non-custom mode', () => {
    const policy = createSitePolicy('shift_8h');

    const result = getEffectiveThresholds(policy, 1);

    expect(result).toEqual({
      hunger: policy.hungerRestThreshold,
      fatigue: policy.fatigueRestThreshold,
    });
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('returns the per-employee override when shiftMode is custom and one exists for the given id', () => {
    const policy = createSitePolicy('custom');
    const employeeId = 7;
    policy.customThresholds[employeeId] = { hunger: 70, fatigue: 10, social: 10 };

    const result = getEffectiveThresholds(policy, employeeId);

    expect(result).toEqual({ hunger: 70, fatigue: 10 });
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('falls back to the policy-level defaults in custom mode when no override exists for the given id', () => {
    const policy = createSitePolicy('custom');
    // Only employee 99 has an override — employee 1 does not.
    policy.customThresholds[99] = { hunger: 70, fatigue: 10, social: 10 };

    const result = getEffectiveThresholds(policy, 1);

    expect(result).toEqual({
      hunger: policy.hungerRestThreshold,
      fatigue: policy.fatigueRestThreshold,
    });
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('falls back to the policy-level defaults in custom mode when employeeId is omitted', () => {
    const policy = createSitePolicy('custom');
    policy.customThresholds[7] = { hunger: 70, fatigue: 10, social: 10 };

    const result = getEffectiveThresholds(policy);

    expect(result).toEqual({
      hunger: policy.hungerRestThreshold,
      fatigue: policy.fatigueRestThreshold,
    });
  });
});

describe('policy revision', () => {
  it('a fresh policy starts at revision 0', () => {
    expect(createSitePolicy().revision).toBe(0);
  });

  it('is part of the policy, so applying one can be observed at all', () => {
    // Whether a player has set a policy cannot be read from the values:
    // applying the policy already in force changes none of them.
    const policy = createSitePolicy();
    expect(typeof policy.revision).toBe('number');
  });
});
