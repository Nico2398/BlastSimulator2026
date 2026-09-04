import { describe, it, expect } from 'vitest';
import { linearstep } from '../../../src/core/math/Linearstep.js';

describe('linearstep', () => {
  it('returns 0 at or below the lower edge', () => {
    expect(linearstep(0, 10, 0)).toBe(0);
    expect(linearstep(0, 10, -5)).toBe(0);
  });

  it('returns 1 at or above the upper edge', () => {
    expect(linearstep(0, 10, 10)).toBe(1);
    expect(linearstep(0, 10, 20)).toBe(1);
  });

  it('returns 0.5 at the midpoint', () => {
    expect(linearstep(0, 10, 5)).toBe(0.5);
  });

  it('handles degenerate a === b by stepping at that point', () => {
    expect(linearstep(5, 5, 4)).toBe(0);
    expect(linearstep(5, 5, 5)).toBe(1);
    expect(linearstep(5, 5, 6)).toBe(1);
  });

  it('is exactly linear at the quarter point, not smoothstep-curved', () => {
    // Smoothstep(3x²-2x³) at x=0.25 would give ≈0.104. Linear must give exactly 0.25.
    expect(linearstep(0, 10, 2.5)).toBe(0.25);
  });

  it('is exactly linear at the three-quarter point, not smoothstep-curved', () => {
    // Smoothstep at x=0.75 would give ≈0.896. Linear must give exactly 0.75.
    expect(linearstep(0, 10, 7.5)).toBe(0.75);
  });

  it('computes (t-a)/(b-a) exactly across interior points', () => {
    expect(linearstep(0, 4, 1)).toBe(0.25);
    expect(linearstep(0, 4, 3)).toBe(0.75);
    expect(linearstep(-10, 10, 0)).toBe(0.5);
    expect(linearstep(-10, 10, -5)).toBe(0.25);
  });

  it('handles a descending (a > b) range consistently with the general formula', () => {
    expect(() => linearstep(10, 0, 5)).not.toThrow();
  });
});
