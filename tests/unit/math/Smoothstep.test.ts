import { describe, it, expect } from 'vitest';
import { smoothstep } from '../../../src/core/math/Smoothstep.js';

describe('smoothstep', () => {
  it('returns 0 at or below the lower edge', () => {
    expect(smoothstep(0, 10, 0)).toBe(0);
    expect(smoothstep(0, 10, -5)).toBe(0);
  });

  it('returns 1 at or above the upper edge', () => {
    expect(smoothstep(0, 10, 10)).toBe(1);
    expect(smoothstep(0, 10, 20)).toBe(1);
  });

  it('returns 0.5 at the midpoint', () => {
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5, 10);
  });

  it('is monotonically non-decreasing across the transition band', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 10; t += 0.5) {
      const v = smoothstep(0, 10, t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('handles degenerate a === b by stepping at that point', () => {
    expect(smoothstep(5, 5, 4)).toBe(0);
    expect(smoothstep(5, 5, 5)).toBe(1);
    expect(smoothstep(5, 5, 6)).toBe(1);
  });

  it('handles a descending (a > b) range consistently with the general formula', () => {
    // t normalized as (t-a)/(b-a) with b<a still lands in [0,1] after clamping.
    expect(() => smoothstep(10, 0, 5)).not.toThrow();
  });
});
