import { describe, it, expect } from 'vitest';
import { hash32, subSeed, cellRand } from '../../../src/core/math/Hash.js';

describe('hash32', () => {
  it('is deterministic for the same input', () => {
    expect(hash32(42)).toBe(hash32(42));
  });

  it('produces different outputs for different inputs', () => {
    expect(hash32(1)).not.toBe(hash32(2));
  });

  it('always returns a non-negative 32-bit unsigned integer', () => {
    for (const x of [0, 1, -1, 42, 1e9, -1e9]) {
      const h = hash32(x);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(h)).toBe(true);
    }
  });
});

describe('subSeed', () => {
  it('is deterministic for the same seed and label', () => {
    expect(subSeed(42, 'continentalness')).toBe(subSeed(42, 'continentalness'));
  });

  it('produces independent seeds for different labels', () => {
    expect(subSeed(42, 'continentalness')).not.toBe(subSeed(42, 'erosion'));
  });

  it('produces different seeds for different base seeds with the same label', () => {
    expect(subSeed(42, 'erosion')).not.toBe(subSeed(99, 'erosion'));
  });

  it('handles an empty label without throwing', () => {
    expect(() => subSeed(42, '')).not.toThrow();
  });
});

describe('cellRand', () => {
  it('is deterministic for the same inputs', () => {
    expect(cellRand(1, 2, 3, 4)).toBe(cellRand(1, 2, 3, 4));
  });

  it('returns a value in [0, 1)', () => {
    for (let i = 0; i < 50; i++) {
      const v = cellRand(1, i, i * 7, i * 13);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('varies with cell coordinates', () => {
    expect(cellRand(1, 0, 0, 0)).not.toBe(cellRand(1, 1, 0, 0));
    expect(cellRand(1, 0, 0, 0)).not.toBe(cellRand(1, 0, 1, 0));
  });

  it('varies with the salt (independent placement channels at the same cell)', () => {
    expect(cellRand(1, 5, 5, 0)).not.toBe(cellRand(1, 5, 5, 1));
  });
});
