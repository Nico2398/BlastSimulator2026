// BlastSimulator2026 — Safety soft clipper curve tests

import { describe, it, expect } from 'vitest';
import { buildSoftClipCurve, softClip } from '../../../../src/audio/engine/softClip.js';
import { MASTER_LIMITER_CONFIG } from '../../../../src/core/config/audio/engine.js';

const { clipKnee: KNEE, clipCeiling: CEILING, clipCurveSize: SIZE } = MASTER_LIMITER_CONFIG;
const clip = (x: number): number => softClip(x, KNEE, CEILING);

describe('softClip', () => {
  it('is the identity up to the knee, exactly', () => {
    for (const x of [0, 0.001, 0.25, 0.5, KNEE, -0.3, -KNEE]) expect(clip(x)).toBe(x);
  });

  it('bends above the knee but stays below the ceiling', () => {
    for (const x of [KNEE + 0.01, 0.9, 1, 1.5]) {
      expect(clip(x)).toBeLessThan(x);
      expect(clip(x)).toBeGreaterThan(KNEE);
      expect(clip(x)).toBeLessThanOrEqual(CEILING);
    }
  });

  it('is bounded by the ceiling for any finite input, huge ones included', () => {
    for (const x of [2, 10, 1e6, 1e300, Number.MAX_VALUE, -2, -1e6, -Number.MAX_VALUE]) {
      expect(Math.abs(clip(x))).toBeLessThanOrEqual(CEILING);
    }
    expect(clip(1e300)).toBeCloseTo(CEILING, 12);
  });

  it('is odd-symmetric', () => {
    for (const x of [0.1, 0.79, 0.81, 0.95, 1, 3, 1e9]) expect(clip(-x)).toBe(-clip(x));
  });

  it('is strictly increasing across the knee and the shoulder', () => {
    let previous = clip(-1);
    for (let x = -0.999; x <= 1; x += 0.001) {
      const y = clip(x);
      expect(y).toBeGreaterThan(previous);
      previous = y;
    }
  });

  it('is continuous with slope 1 at the knee', () => {
    const h = 1e-6;
    expect(clip(KNEE + h) - clip(KNEE)).toBeCloseTo(h, 10);
    const slopeAbove = (clip(KNEE + 2 * h) - clip(KNEE + h)) / h;
    const slopeBelow = (clip(KNEE - h) - clip(KNEE - 2 * h)) / h;
    expect(slopeBelow).toBeCloseTo(1, 6);
    expect(slopeAbove).toBeCloseTo(1, 4);
  });

  it('has a slope that only decreases above the knee (a shoulder, never a bump)', () => {
    const h = 0.01;
    let previousSlope = 1.000001;
    for (let x = KNEE; x < 1.5; x += h) {
      const slope = (clip(x + h) - clip(x)) / h;
      expect(slope).toBeLessThanOrEqual(previousSlope);
      previousSlope = slope;
    }
  });
});

describe('buildSoftClipCurve', () => {
  const curve = buildSoftClipCurve(SIZE, KNEE, CEILING);

  it('has the requested size, with a sample at exactly zero', () => {
    expect(curve).toHaveLength(SIZE);
    expect(SIZE % 2).toBe(1);
    expect(curve[(SIZE - 1) / 2]).toBe(0);
  });

  it('is exactly odd-symmetric', () => {
    for (let i = 0; i < SIZE; i++) expect(curve[i]! + curve[SIZE - 1 - i]!).toBe(0);
  });

  it('is non-decreasing and bounded by the ceiling', () => {
    for (let i = 1; i < SIZE; i++) expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!);
    expect(curve[SIZE - 1]!).toBeLessThanOrEqual(CEILING);
    expect(curve[0]!).toBeGreaterThanOrEqual(-CEILING);
  });

  it('is the identity (to float32 precision) wherever the input is below the knee', () => {
    const mid = (SIZE - 1) / 2;
    for (let i = 0; i < SIZE; i++) {
      const x = (i - mid) / mid;
      if (Math.abs(x) <= KNEE) expect(curve[i]).toBeCloseTo(x, 6);
    }
  });

  it('ends at the shoulder value for a full-scale input, a little under the ceiling', () => {
    expect(curve[SIZE - 1]).toBeCloseTo(clip(1), 6);
    expect(curve[SIZE - 1]!).toBeGreaterThan(KNEE);
    expect(curve[SIZE - 1]!).toBeLessThan(CEILING);
  });
});
