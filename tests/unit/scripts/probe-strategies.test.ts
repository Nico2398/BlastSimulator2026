import { describe, it, expect } from 'vitest';
import { PERMIT_LIMITS } from '../../../src/core/config/balance.js';
import { RELOAD_FRACTION, shouldReload, SHOT } from '../../../scripts/shared/probe-strategies.js';

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

  it('hole count fits the grade-0 permit', () => {
    expect(SHOT.rows * SHOT.cols).toBeLessThanOrEqual(limit.maxHoles);
  });
});

describe('PERMIT_LIMITS monotonic (#1944)', () => {
  it('maxChargeKg and maxHoles strictly rise grade 0 < 1 < 2', () => {
    for (const g of [0, 1]) {
      expect(PERMIT_LIMITS[g]!.maxChargeKg).toBeLessThan(PERMIT_LIMITS[g + 1]!.maxChargeKg);
      expect(PERMIT_LIMITS[g]!.maxHoles).toBeLessThan(PERMIT_LIMITS[g + 1]!.maxHoles);
    }
  });

  it('grade-1 limits accommodate the grade-0 reference opening', () => {
    expect(PERMIT_LIMITS[1]!.maxChargeKg).toBeGreaterThanOrEqual(SHOT.rows * SHOT.cols * SHOT.kg);
    expect(PERMIT_LIMITS[1]!.maxHoles).toBeGreaterThanOrEqual(SHOT.rows * SHOT.cols);
  });
});
