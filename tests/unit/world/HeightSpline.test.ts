import { describe, it, expect } from 'vitest';
import { evalSpline, type Spline } from '../../../src/core/world/HeightSpline.js';

describe('evalSpline', () => {
  const s: Spline = [[-1, 0], [0, 10], [1, 20]];

  it('clamps to the first control point below the range', () => {
    expect(evalSpline(s, -5)).toBe(0);
    expect(evalSpline(s, -1)).toBe(0);
  });

  it('clamps to the last control point above the range', () => {
    expect(evalSpline(s, 5)).toBe(20);
    expect(evalSpline(s, 1)).toBe(20);
  });

  it('interpolates linearly between two control points', () => {
    expect(evalSpline(s, -0.5)).toBeCloseTo(5, 10);
    expect(evalSpline(s, 0.5)).toBeCloseTo(15, 10);
  });

  it('returns the exact control point value at a knot', () => {
    expect(evalSpline(s, 0)).toBe(10);
  });

  it('returns 0 for an empty spline (rejection case)', () => {
    expect(evalSpline([], 0.5)).toBe(0);
  });

  it('handles a single-control-point spline as a constant', () => {
    const single: Spline = [[0, 42]];
    expect(evalSpline(single, -5)).toBe(42);
    expect(evalSpline(single, 5)).toBe(42);
  });
});
