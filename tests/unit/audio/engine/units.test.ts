import { describe, it, expect } from 'vitest';
import { centsToRate, clamp, dbToGain } from '../../../../src/audio/engine/units.js';

describe('audio units', () => {
  it('clamp holds a value inside the range', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });

  it('dbToGain maps 0 dB to unity and 20 dB steps to decades', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 10);
    expect(dbToGain(20)).toBeCloseTo(10, 10);
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 4);
  });

  it('centsToRate maps an octave to a factor of two', () => {
    expect(centsToRate(0)).toBe(1);
    expect(centsToRate(1200)).toBeCloseTo(2, 10);
    expect(centsToRate(-1200)).toBeCloseTo(0.5, 10);
  });
});
