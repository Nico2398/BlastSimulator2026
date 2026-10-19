// BlastSimulator2026 — Tests for HoleDiameter.ts (issue #1934)

import { describe, it, expect } from 'vitest';
import {
  chargeKgPerMetre,
  holeCapacityFactor,
  minRigTierForDiameter,
  normaliseHoleDiameter,
} from '../../../src/core/mining/HoleDiameter.js';

describe('chargeKgPerMetre (#1934)', () => {
  it('is 2.0 kg/m at the default 89 mm', () => {
    expect(chargeKgPerMetre(0.089)).toBeCloseTo(2.0, 9);
    expect(chargeKgPerMetre()).toBeCloseTo(2.0, 9);
  });

  it('scales with diameter squared: about 4.07 at 127 mm and 6.87 at 165 mm', () => {
    expect(chargeKgPerMetre(0.127)).toBeCloseTo(4.07, 2);
    expect(chargeKgPerMetre(0.165)).toBeCloseTo(6.87, 2);
  });

  it('boundary: grows strictly with diameter', () => {
    expect(chargeKgPerMetre(0.127)).toBeGreaterThan(chargeKgPerMetre(0.089));
    expect(chargeKgPerMetre(0.165)).toBeGreaterThan(chargeKgPerMetre(0.127));
  });
});

describe('holeCapacityFactor (#1934)', () => {
  it('is exactly 1 at the default diameter', () => {
    expect(holeCapacityFactor(0.089)).toBe(1);
    expect(holeCapacityFactor()).toBe(1);
  });

  it('equals (d / 0.089)^2', () => {
    expect(holeCapacityFactor(0.127)).toBeCloseTo((0.127 / 0.089) ** 2, 9);
    expect(holeCapacityFactor(0.165)).toBeCloseTo((0.165 / 0.089) ** 2, 9);
  });
});

describe('minRigTierForDiameter (#1934)', () => {
  it('maps 89 / 127 / 165 mm to tier 1 / 2 / 3', () => {
    expect(minRigTierForDiameter(0.089)).toBe(1);
    expect(minRigTierForDiameter(0.127)).toBe(2);
    expect(minRigTierForDiameter(0.165)).toBe(3);
  });

  it('boundary: a diameter just past a tier limit needs the next tier', () => {
    expect(minRigTierForDiameter(0.09)).toBe(2);
    expect(minRigTierForDiameter(0.13)).toBe(3);
  });

  it('a diameter below the default still needs only tier 1', () => {
    expect(minRigTierForDiameter(0.05)).toBe(1);
  });
});

describe('normaliseHoleDiameter (#1934)', () => {
  it('accepts millimetres', () => {
    expect(normaliseHoleDiameter(89)).toBeCloseTo(0.089, 9);
    expect(normaliseHoleDiameter(127)).toBeCloseTo(0.127, 9);
    expect(normaliseHoleDiameter(165)).toBeCloseTo(0.165, 9);
  });

  it('accepts metres', () => {
    expect(normaliseHoleDiameter(0.089)).toBeCloseTo(0.089, 9);
    expect(normaliseHoleDiameter(0.127)).toBeCloseTo(0.127, 9);
    expect(normaliseHoleDiameter(0.165)).toBeCloseTo(0.165, 9);
  });

  it('snaps a near-miss within tolerance to the option', () => {
    expect(normaliseHoleDiameter(0.1272)).toBeCloseTo(0.127, 9);
  });

  it('rejects values matching no option', () => {
    expect(normaliseHoleDiameter(100)).toBeNull();
    expect(normaliseHoleDiameter(0.1)).toBeNull();
  });

  it('rejects NaN, zero, negative and infinite input', () => {
    expect(normaliseHoleDiameter(NaN)).toBeNull();
    expect(normaliseHoleDiameter(0)).toBeNull();
    expect(normaliseHoleDiameter(-89)).toBeNull();
    expect(normaliseHoleDiameter(-0.089)).toBeNull();
    expect(normaliseHoleDiameter(Infinity)).toBeNull();
  });
});
