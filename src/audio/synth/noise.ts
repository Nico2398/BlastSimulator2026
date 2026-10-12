// BlastSimulator2026 — Noise sources

import type { Random } from '../../core/math/Random.js';

/** Uniform white noise in [-1, 1). */
export function whiteNoise(rng: Random, length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rng.next() * 2 - 1;
  return out;
}

/** Leaky-integrated white noise (about -6 dB per octave above `cornerHz`), scaled to unit RMS. */
export function brownNoise(rng: Random, length: number, sampleRate: number, cornerHz: number): Float32Array {
  const out = new Float32Array(length);
  const leak = Math.exp((-2 * Math.PI * cornerHz) / sampleRate);
  let state = 0;
  let energy = 0;
  for (let i = 0; i < length; i++) {
    state = state * leak + (rng.next() * 2 - 1);
    out[i] = state;
    energy += state * state;
  }
  const scale = energy > 0 ? 1 / Math.sqrt(energy / length) : 1;
  for (let i = 0; i < length; i++) out[i] = (out[i] as number) * scale;
  return out;
}

/** Scale in place to unit RMS (no-op on silence); returns the same buffer. */
export function unitRms(samples: Float32Array): Float32Array {
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += (samples[i] as number) ** 2;
  if (energy === 0) return samples;
  const scale = 1 / Math.sqrt(energy / samples.length);
  for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] as number) * scale;
  return samples;
}
