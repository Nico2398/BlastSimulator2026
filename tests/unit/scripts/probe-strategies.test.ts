import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMIT_LIMITS } from '../../../src/core/config/balance.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { patternAreaM2 } from '../../../src/core/mining/ChargePlan.js';
import { RELOAD_FRACTION, shouldReload, SHOT } from '../../../scripts/shared/probe-strategies.js';

/** Permit area (m²) of the reference opening's grid, as the permit measures the holes `drill_plan grid` lays out. */
const shotAreaM2 = (): number =>
  patternAreaM2(createGridPlan({ nextHoleId: 1 }, { x: 0, z: 0 }, SHOT.rows, SHOT.cols, SHOT.spacing, SHOT.depth, 0.089));

describe('probe reload gate', () => {
  it('RELOAD_FRACTION is one half', () => {
    expect(RELOAD_FRACTION).toBe(0.5);
  });

  it('reloads when haulable ore fell under half of the last yield', () => {
    expect(shouldReload(499, 1000)).toBe(true);
    expect(shouldReload(0, 1000)).toBe(true);
  });

  it('does not reload at exactly the boundary', () => {
    expect(shouldReload(500, 1000)).toBe(false);
  });

  it('does not reload above the boundary', () => {
    expect(shouldReload(501, 1000)).toBe(false);
    expect(shouldReload(5000, 1000)).toBe(false);
  });

  it('never reloads without a prior yield', () => {
    expect(shouldReload(0, 0)).toBe(false);
    expect(shouldReload(100, 0)).toBe(false);
    expect(shouldReload(0, -5)).toBe(false);
  });
});

describe('reference opening SHOT (#1944)', () => {
  const limit = PERMIT_LIMITS[0]!;

  it('is a square 2x2 or 3x3 grid', () => {
    expect(SHOT.rows).toBe(SHOT.cols);
    expect([2, 3]).toContain(SHOT.rows);
  });

  it('drills 4 to 6 deep', () => {
    expect(SHOT.depth).toBeGreaterThanOrEqual(4);
    expect(SHOT.depth).toBeLessThanOrEqual(6);
  });

  it('total charge fits the grade-0 permit', () => {
    expect(SHOT.rows * SHOT.cols * SHOT.kg).toBeLessThanOrEqual(limit.maxChargeKg);
  });

  it('pattern area fits the grade-0 permit', () => {
    expect(shotAreaM2()).toBe(SHOT.rows * SHOT.cols * SHOT.spacing ** 2);
    expect(shotAreaM2()).toBeLessThanOrEqual(limit.maxAreaM2);
  });
});

describe('PERMIT_LIMITS monotonic (#1944)', () => {
  it('maxChargeKg and maxAreaM2 strictly rise grade 0 < 1 < 2', () => {
    for (const g of [0, 1]) {
      expect(PERMIT_LIMITS[g]!.maxChargeKg).toBeLessThan(PERMIT_LIMITS[g + 1]!.maxChargeKg);
      expect(PERMIT_LIMITS[g]!.maxAreaM2).toBeLessThan(PERMIT_LIMITS[g + 1]!.maxAreaM2);
    }
  });

  it('grade-1 limits accommodate the grade-0 reference opening', () => {
    expect(PERMIT_LIMITS[1]!.maxChargeKg).toBeGreaterThanOrEqual(SHOT.rows * SHOT.cols * SHOT.kg);
    expect(PERMIT_LIMITS[1]!.maxAreaM2).toBeGreaterThanOrEqual(shotAreaM2());
  });
});

describe('probe ramps follow the one vehicle slope limit (#2045)', () => {
  const source = readFileSync(join(__dirname, '../../../scripts/shared/probe-strategies.ts'), 'utf8');
  const ladder = readFileSync(join(__dirname, '../../../scripts/shared/probe-ladder.ts'), 'utf8');

  it('cuts ramps at the progression cut ratio, not a hand-picked 0.45 that works only through the zigzag', () => {
    expect(source).not.toMatch(/RAMP_MAX_SLOPE\s*=\s*0\.45/);
    expect(source).toContain('rampCutSlopeRatio(true)');
  });

  it('no longer reads per-tier slope limits or digs a gentle-ramp retry', () => {
    for (const text of [source, ladder]) {
      expect(text).not.toContain('tierSlopeRatio');
      expect(text).not.toContain('VEHICLE_TIER_MAX_SLOPE_DEGREES');
    }
    expect(source).not.toContain('gentle_ramp');
  });
});
