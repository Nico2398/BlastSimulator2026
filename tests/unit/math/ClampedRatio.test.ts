import { describe, it, expect } from 'vitest';
import { clampedRatio } from '../../../src/core/math/ClampedRatio.js';

describe('clampedRatio', () => {
  it('returns 0 at or below the lower edge', () => {
    expect(clampedRatio(0, 10, 0)).toBe(0);
    expect(clampedRatio(0, 10, -5)).toBe(0);
  });

  it('returns 1 at or above the upper edge', () => {
    expect(clampedRatio(0, 10, 10)).toBe(1);
    expect(clampedRatio(0, 10, 20)).toBe(1);
  });

  it('returns the linear ratio at interior points', () => {
    expect(clampedRatio(0, 10, 5)).toBe(0.5);
    expect(clampedRatio(0, 4, 1)).toBe(0.25);
  });

  it('handles degenerate a === b by stepping at that point', () => {
    expect(clampedRatio(5, 5, 4)).toBe(0);
    expect(clampedRatio(5, 5, 5)).toBe(1);
    expect(clampedRatio(5, 5, 6)).toBe(1);
  });

  it('handles a descending (a > b) range consistently with the general formula', () => {
    expect(clampedRatio(10, 0, 5)).toBe(0.5);
  });
});
