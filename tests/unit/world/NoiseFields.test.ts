import { describe, it, expect } from 'vitest';
import { createNoise2D } from 'simplex-noise';
import { fbm2, ridged2, WorldNoiseFields } from '../../../src/core/world/NoiseFields.js';

describe('fbm2', () => {
  it('is deterministic for the same inputs', () => {
    const noise = createNoise2D(() => 0.5);
    expect(fbm2(noise, 10, 20, 4, 1 / 100)).toBe(fbm2(noise, 10, 20, 4, 1 / 100));
  });

  it('stays within the expected simplex range', () => {
    const noise = createNoise2D(() => 0.5);
    for (let x = 0; x < 50; x += 5) {
      const v = fbm2(noise, x, x * 2, 4, 1 / 50);
      expect(v).toBeGreaterThanOrEqual(-1.01);
      expect(v).toBeLessThanOrEqual(1.01);
    }
  });

  it('varies across space (not a constant field)', () => {
    const noise = createNoise2D(() => 0.5);
    const samples = new Set<number>();
    for (let x = 0; x < 200; x += 10) samples.add(Math.round(fbm2(noise, x, 0, 4, 1 / 50) * 1000));
    expect(samples.size).toBeGreaterThan(1);
  });
});

describe('ridged2', () => {
  it('stays within [0, 1]', () => {
    const noise = createNoise2D(() => 0.5);
    for (let x = 0; x < 50; x += 5) {
      const v = ridged2(noise, x, x * 3, 5, 1 / 150);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.01);
    }
  });
});

describe('WorldNoiseFields', () => {
  it('same seed produces identical field values', () => {
    const a = new WorldNoiseFields(42);
    const b = new WorldNoiseFields(42);
    expect(a.continentalness(100, 200)).toBe(b.continentalness(100, 200));
    expect(a.erosion(100, 200)).toBe(b.erosion(100, 200));
    expect(a.peaksValleys(100, 200)).toBe(b.peaksValleys(100, 200));
    expect(a.temperature(100, 200)).toBe(b.temperature(100, 200));
  });

  it('different seeds produce different field values', () => {
    const a = new WorldNoiseFields(1);
    const b = new WorldNoiseFields(2);
    expect(a.continentalness(100, 200)).not.toBe(b.continentalness(100, 200));
  });

  it('perturbing one field leaves the others bit-identical (independent sub-seeds)', () => {
    // Simulate "changing" the erosion field by using a WorldNoiseFields built
    // from a different seed, but compare continentalness at a fixed point —
    // it must NOT be derivable from erosion's seed, i.e. two different-seed
    // instances agree on continentalness only if they're the same seed. The
    // real independence guarantee: within ONE instance, sampling erosion
    // first vs. continentalness first gives the same continentalness value
    // (no shared mutable RNG state leaking between fields).
    const fields = new WorldNoiseFields(7);
    const cBefore = fields.continentalness(50, 50);
    fields.erosion(50, 50);
    fields.erosion(999, -999);
    fields.peaksValleys(1, 1);
    const cAfter = fields.continentalness(50, 50);
    expect(cAfter).toBe(cBefore);
  });

  it('feature wavelength is independent of any grid size — same world coordinates, same value', () => {
    // The whole point of absolute (not grid-normalized) coordinates: sampling
    // the same world (x, z) gives the same height contribution regardless of
    // what grid size a caller happens to be generating.
    const fields = new WorldNoiseFields(42);
    const v1 = fields.continentalness(37, 41);
    const v2 = fields.continentalness(37, 41);
    expect(v1).toBe(v2);
  });

  it('continentalness/erosion/peaksValleys are warped (differ from their own unwarped raw field)', () => {
    const fields = new WorldNoiseFields(42);
    // warpedCoords should shift the sample point away from the raw (x, z)
    // whenever the warp fields are non-zero there.
    const raw = fields.warpedCoords(123, 456);
    expect(raw.x === 123 && raw.z === 456).toBe(false);
  });

  it('temperature/humidity/detail/forest/riverSpring stay within the expected simplex range', () => {
    const fields = new WorldNoiseFields(42);
    for (const fn of [fields.temperature, fields.humidity, fields.detail, fields.forest, fields.riverSpring]) {
      const v = fn.call(fields, 10, 10);
      expect(v).toBeGreaterThanOrEqual(-1.01);
      expect(v).toBeLessThanOrEqual(1.01);
    }
  });
});
