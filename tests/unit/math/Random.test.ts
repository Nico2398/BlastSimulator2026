import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';

describe('Random — determinism', () => {
  it('same seed produces the same sequence', () => {
    const a = new Random(42);
    const b = new Random(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different sequences', () => {
    const a = new Random(42);
    const b = new Random(99);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      if (a.next() === b.next()) same++;
    }
    // Statistically impossible for all 100 to match with different seeds
    expect(same).toBeLessThan(10);
  });
});

describe('Random — range', () => {
  it('next() returns values in [0, 1)', () => {
    const rng = new Random(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(min, max) returns integers in [min, max]', () => {
    const rng = new Random(456);
    for (let i = 0; i < 500; i++) {
      const v = rng.nextInt(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('nextFloat(min, max) returns floats in [min, max)', () => {
    const rng = new Random(789);
    for (let i = 0; i < 500; i++) {
      const v = rng.nextFloat(2.0, 5.0);
      expect(v).toBeGreaterThanOrEqual(2.0);
      expect(v).toBeLessThan(5.0);
    }
  });
});
