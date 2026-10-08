/**
 * tests/unit/entities/SitePolicy.test.ts
 *
 * Task 3.12 — Red-phase tests for SitePolicy shift/rest scheduling.
 *
 * #928: hunger and breakNeed thresholds (hungerRestThreshold,
 * socialBreakThreshold, and their EmployeeSnapshot counterparts) were removed — fatigue is the sole gauge SitePolicy governs.
 *
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
import { SHIFT_DURATIONS_TICKS, SITE_POLICY_DEFAULT_THRESHOLD } from '../../../src/core/config/balance.js';

// ─── createSitePolicy() ───────────────────────────────────────────────────────

describe('createSitePolicy() (3.12)', () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it("createSitePolicy('shift_8h') returns shiftMode 'shift_8h' with correct default threshold", () => {
    const policy: SitePolicy = createSitePolicy('shift_8h');

    expect(policy.shiftMode).toBe('shift_8h');
    expect(policy.fatigueRestThreshold).toBe(SITE_POLICY_DEFAULT_THRESHOLD);
    expect(policy.fatigueRestThreshold).toBe(60);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("createSitePolicy('continuous') returns shiftMode 'continuous'", () => {
    const policy: SitePolicy = createSitePolicy('continuous');

    expect(policy.shiftMode).toBe('continuous');
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('createSitePolicy() with no argument returns a valid policy with default shiftMode', () => {
    const policy: SitePolicy = createSitePolicy();

    // Must be one of the three valid shift modes (#1388: 'custom' removed)
    const validModes: ShiftMode[] = ['shift_8h', 'shift_12h', 'continuous'];
    expect(validModes).toContain(policy.shiftMode);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('createSitePolicy() carries no per-employee customThresholds (#1388)', () => {
    const policy: SitePolicy = createSitePolicy('continuous');

    expect('customThresholds' in policy).toBe(false);
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
});

// ─── shouldForceRest() — shift-duration logic ────────────────────────────────

describe('shouldForceRest() — shift-duration enforcement (3.12)', () => {
  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('returns true when ticksWorked equals the shift_8h shift duration', () => {
    const policy = createSitePolicy('shift_8h');
    // Employee is just above the threshold so only the shift boundary triggers rest
    const employee = { fatigue: 80, ticksWorked: 8 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });

  // ── Test 10 ──────────────────────────────────────────────────────────────────
  it('returns true when ticksWorked exceeds the shift_8h shift duration', () => {
    const policy = createSitePolicy('shift_8h');
    const employee = { fatigue: 80, ticksWorked: 10 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });

  // ── Test 11 ──────────────────────────────────────────────────────────────────
  it('returns false when ticksWorked is below the shift_8h shift duration and fatigue is healthy', () => {
    const policy = createSitePolicy('shift_8h');
    // ticksWorked=5 < 8, and fatigue well above threshold
    const employee = { fatigue: 80, ticksWorked: 5 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(false);
  });

  // ── Test 12 ──────────────────────────────────────────────────────────────────
  it('returns false for continuous mode regardless of how many ticks the employee has worked', () => {
    const policy = createSitePolicy('continuous');
    // Even with massive ticksWorked and healthy fatigue, continuous mode never forces shift rest
    const employee = { fatigue: 80, ticksWorked: 9999 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(false);
  });

  // ── Test 13 ──────────────────────────────────────────────────────────────────
  it('returns false for shift_8h when the employee is not currently working', () => {
    const policy = createSitePolicy('shift_8h');
    // ticksWorked ≥ shift duration but employee is already resting
    const employee = { fatigue: 80, ticksWorked: 8 };

    const result = shouldForceRest(policy, employee, false);

    expect(result).toBe(false);
  });
});

// ─── shouldForceRest() — need-threshold logic ───────────────────────────────

describe('shouldForceRest() — need-threshold enforcement (3.12)', () => {
  // ── Test 14 ──────────────────────────────────────────────────────────────────
  it('returns true when fatigue drops below fatigueRestThreshold even if shift is not over', () => {
    const policy = createSitePolicy('shift_8h');
    // fatigue (20) < fatigueRestThreshold (60); ticksWorked well below shift end
    const employee = { fatigue: 20, ticksWorked: 2 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });

  // ── Test 15 ──────────────────────────────────────────────────────────────────
  it('returns false when fatigue is above its threshold and ticksWorked < shift duration', () => {
    const policy = createSitePolicy('shift_8h');
    // fatigue (70) > 60, ticksWorked (3) < 8 → no rest needed
    const employee = { fatigue: 70, ticksWorked: 3 };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(false);
  });

  // ── Test 16 ──────────────────────────────────────────────────────────────────
  it('returns true when fatigue is exactly at the fatigueRestThreshold (boundary condition)', () => {
    const policy = createSitePolicy('shift_8h');
    const employee = { fatigue: policy.fatigueRestThreshold, ticksWorked: 2 };

    // The boundary value itself is expected to trigger rest (fatigue IS at threshold level)
    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(true);
  });

  // ── Test 17 ──────────────────────────────────────────────────────────────────
  it('returns false when fatigue is one point above its threshold', () => {
    const policy = createSitePolicy('shift_8h');
    // fatigue = 61 > 60 — just above threshold; shift not over
    const employee = {
      fatigue: policy.fatigueRestThreshold + 1,
      ticksWorked: 3,
    };

    const result = shouldForceRest(policy, employee, true);

    expect(result).toBe(false);
  });
});

// ─── shouldForceRest() — one site-wide threshold (#1388) ─────────────────────

describe('shouldForceRest() — single site-wide fatigue threshold (#1388)', () => {
  it('uses the policy threshold for every employee id', () => {
    const policy: SitePolicy = createSitePolicy('continuous');
    policy.fatigueRestThreshold = 50;

    expect(shouldForceRest(policy, { id: 3, fatigue: 40, ticksWorked: 1 }, true)).toBe(true);
    expect(shouldForceRest(policy, { id: 4, fatigue: 80, ticksWorked: 1 }, true)).toBe(false);
  });
});

// ─── getEffectiveThresholds() (#678) ─────────────────────────────────────────
//
// Extracted from shouldForceRest's own custom-mode override lookup so
// ForceShiftRest.ts's forced-rest-under-policy path (#678) can report which
// threshold actually applied, not just a yes/no verdict.

describe('getEffectiveThresholds() (#678)', () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('returns the policy-level default threshold for a non-custom mode', () => {
    const policy = createSitePolicy('shift_8h');

    const result = getEffectiveThresholds(policy, 1);

    expect(result).toEqual({ fatigue: policy.fatigueRestThreshold });
  });

  it('ignores the employee id: every employee gets the site threshold (#1388)', () => {
    const policy = createSitePolicy('continuous');
    policy.fatigueRestThreshold = 35;

    expect(getEffectiveThresholds(policy, 7)).toEqual({ fatigue: 35 });
    expect(getEffectiveThresholds(policy)).toEqual({ fatigue: 35 });
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
