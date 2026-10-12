import { describe, it, expect } from 'vitest';
import { resampleLinear } from '../../../../src/audio/engine/resample.js';

describe('resampleLinear', () => {
  it('returns the input untouched at the same rate or when empty', () => {
    const input = Float32Array.of(1, 2, 3);
    expect(resampleLinear(input, 44100, 44100)).toBe(input);
    const empty = new Float32Array(0);
    expect(resampleLinear(empty, 44100, 48000)).toBe(empty);
  });

  it('scales the length by the rate ratio', () => {
    expect(resampleLinear(new Float32Array(441), 44100, 48000)).toHaveLength(480);
    expect(resampleLinear(new Float32Array(480), 48000, 44100)).toHaveLength(441);
  });

  it('interpolates linearly between samples', () => {
    const out = resampleLinear(Float32Array.of(0, 1), 1, 2);
    expect(Array.from(out)).toEqual([0, 0.5, 1, 1]);
  });

  it('keeps a constant signal constant, including at the final sample', () => {
    const out = resampleLinear(new Float32Array(100).fill(0.25), 44100, 48000);
    expect(out.every(v => Math.abs(v - 0.25) < 1e-6)).toBe(true);
  });

  it('keeps at least one sample', () => {
    expect(resampleLinear(Float32Array.of(0.5), 48000, 100)).toHaveLength(1);
  });
});
