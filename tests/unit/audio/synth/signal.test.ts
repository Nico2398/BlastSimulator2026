// BlastSimulator2026 — synth DSP kit: seeding, noise, filters, envelopes, oscillators, mixing

import { describe, expect, it } from 'vitest';
import { Random } from '../../../../src/core/math/Random.js';
import { SYNTH_LEVELS } from '../../../../src/core/config/audio/synth.js';
import { attackDecay, controlTrack, decayTo, fadeEdges } from '../../../../src/audio/synth/envelopes.js';
import { Biquad, filterBuffer, type BiquadKind } from '../../../../src/audio/synth/filters.js';
import { dbToGain } from '../../../../src/audio/engine/units.js';
import { mixInto, mixIntoCircular, saturate } from '../../../../src/audio/synth/mix.js';
import { brownNoise, unitRms, whiteNoise } from '../../../../src/audio/synth/noise.js';
import { accumulatePhase, loopSine, sawAt, squareAt } from '../../../../src/audio/synth/oscillators.js';
import { rngFor, variantAt } from '../../../../src/audio/synth/seed.js';
import { goertzelPower, toDb } from './helpers.js';

const SR = 8000;

function sine(freq: number, seconds: number, sampleRate = SR): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

/** Steady-state gain of a filter at one frequency, in dB, measured on the second half. */
function gainDb(kind: BiquadKind, cutoff: number, probe: number, q?: number): number {
  const input = sine(probe, 1);
  const output = filterBuffer(input, kind, SR, cutoff, q);
  const rms = (x: Float32Array): number => Math.sqrt(x.slice(x.length / 2).reduce((s, v) => s + v * v, 0) / (x.length / 2));
  return 20 * Math.log10(rms(output) / rms(input));
}

describe('seed', () => {
  it('rngFor is deterministic and separates recipe, variant and stream', () => {
    expect(rngFor('a', 0).next()).toBe(rngFor('a', 0).next());
    const firsts = [rngFor('a', 0, 0), rngFor('b', 0, 0), rngFor('a', 1, 0), rngFor('a', 0, 1)].map((r) => r.next());
    expect(new Set(firsts).size).toBe(4);
  });

  it('variantAt wraps any integer into range', () => {
    const list = ['x', 'y', 'z'];
    expect([0, 1, 2, 3, 7, -1, -3].map((v) => variantAt(list, v))).toEqual(['x', 'y', 'z', 'x', 'y', 'z', 'x']);
  });
});

describe('noise', () => {
  it('whiteNoise is uniform in [-1, 1) with ~zero mean and reproducible per seed', () => {
    const noise = whiteNoise(new Random(5), 20000);
    expect(Math.min(...noise)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...noise)).toBeLessThan(1);
    expect(Math.abs(noise.reduce((s, v) => s + v, 0) / noise.length)).toBeLessThan(0.02);
    expect(Array.from(whiteNoise(new Random(5), 8))).toEqual(Array.from(noise.slice(0, 8)));
  });

  it('brownNoise has unit RMS and far more low-frequency energy than white noise', () => {
    const brown = brownNoise(new Random(1), 16000, SR, 20);
    const rms = Math.sqrt(brown.reduce((s, v) => s + v * v, 0) / brown.length);
    expect(rms).toBeCloseTo(1, 3);
    const white = whiteNoise(new Random(1), 16000);
    const lag1 = (x: Float32Array): number => {
      let num = 0;
      let den = 0;
      for (let i = 1; i < x.length; i++) {
        num += (x[i] as number) * (x[i - 1] as number);
        den += (x[i] as number) ** 2;
      }
      return num / den;
    };
    expect(lag1(brown)).toBeGreaterThan(0.9);
    expect(Math.abs(lag1(white))).toBeLessThan(0.05);
  });

  it('unitRms rescales in place and leaves silence untouched', () => {
    const buffer = Float32Array.from([0.5, -0.5, 0.5, -0.5]);
    expect(unitRms(buffer)).toBe(buffer);
    expect(buffer[0]).toBeCloseTo(1);
    expect(Array.from(unitRms(new Float32Array(4)))).toEqual([0, 0, 0, 0]);
  });
});

describe('Biquad', () => {
  it('lowpass passes below the cutoff and rejects above it', () => {
    expect(gainDb('lowpass', 1000, 100)).toBeGreaterThan(-0.5);
    expect(gainDb('lowpass', 500, 3000)).toBeLessThan(-30);
  });

  it('highpass passes above the cutoff and rejects below it', () => {
    expect(gainDb('highpass', 1000, 3500)).toBeGreaterThan(-0.5);
    expect(gainDb('highpass', 1000, 50)).toBeLessThan(-30);
  });

  it('bandpass has unity gain at its centre and rejects both sides', () => {
    expect(gainDb('bandpass', 1000, 1000, 2)).toBeGreaterThan(-0.3);
    expect(gainDb('bandpass', 1000, 100, 2)).toBeLessThan(-20);
    expect(gainDb('bandpass', 1000, 3800, 2)).toBeLessThan(-12);
  });

  it('a modulated cutoff changes the response and extreme values stay finite', () => {
    const input = sine(1500, 0.5);
    const fixed = new Biquad('lowpass', SR, 3000);
    const sweeping = new Biquad('lowpass', SR, 3000);
    let fixedEnergy = 0;
    let sweepEnergy = 0;
    input.forEach((x, i) => {
      fixedEnergy += fixed.tick(x) ** 2;
      sweepEnergy += sweeping.tick(x, 3000 - (2900 * i) / input.length) ** 2;
    });
    expect(sweepEnergy).toBeLessThan(fixedEnergy * 0.6);
    const wild = new Biquad('lowpass', SR, 1000);
    for (const hz of [0, -5, 1e9]) expect(Number.isFinite(wild.tick(1, hz))).toBe(true);
  });

  it('refreshes coefficients only every control interval', () => {
    const filter = new Biquad('lowpass', SR, 100);
    const reference = new Biquad('lowpass', SR, 100);
    // within one control interval a requested change is not yet applied
    for (let i = 0; i < SYNTH_LEVELS.filterControlInterval; i++) {
      expect(filter.tick(1, i === 0 ? 100 : 4000)).toBe(reference.tick(1, 100));
    }
  });
});

describe('envelopes', () => {
  it('decayTo starts at `start`, falls a fraction 1 - 1/e of the way in one time constant and settles on `end`', () => {
    expect(decayTo(900, 100, 0, 0.5)).toBe(900);
    expect(decayTo(900, 100, 0.5, 0.5)).toBeCloseTo(100 + 800 / Math.E, 9);
    expect(decayTo(900, 100, 50, 0.5)).toBeCloseTo(100, 9);
    expect(decayTo(100, 900, 0.5, 0.5)).toBeCloseTo(900 - 800 / Math.E, 9); // rising sweeps work the same way
  });

  it('attackDecay is silent before 0, rises over the attack, then decays exponentially', () => {
    expect(attackDecay(-0.1, 0.01, 0.5)).toBe(0);
    expect(attackDecay(0, 0.01, 0.5)).toBe(0);
    expect(attackDecay(0.005, 0.01, 0.5)).toBeGreaterThan(0.3);
    expect(attackDecay(0.01, 0.01, 0.5)).toBeCloseTo(Math.exp(-0.02), 5);
    expect(attackDecay(0.5, 0.01, 0.5)).toBeCloseTo(Math.exp(-1), 5);
  });

  it('fadeEdges brings both ends to zero and leaves the middle alone', () => {
    const samples = new Float32Array(1000).fill(1);
    fadeEdges(samples, 1000, 0.05, 0.1);
    expect(samples[0]).toBe(0);
    expect(samples[999]).toBe(0);
    expect(samples[500]).toBe(1);
    expect(samples[10]).toBeGreaterThan(0);
    expect(samples[10]).toBeLessThan(1);
  });

  it('fadeEdges tolerates fades longer than the buffer', () => {
    const samples = new Float32Array(10).fill(1);
    expect(() => fadeEdges(samples, 1000, 5, 5)).not.toThrow();
    expect(samples.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('controlTrack evaluates the curve at control points and holds in between', () => {
    const interval = SYNTH_LEVELS.envelopeControlInterval;
    const curve = (i: number): number => i * 2;
    const track = controlTrack(100, curve);
    expect(track(0)).toBe(0);
    expect(track(interval - 1)).toBe(0);
    expect(track(interval)).toBe(interval * 2);
    expect(track(99)).toBe(Math.floor(99 / interval) * interval * 2);
  });
});

describe('oscillators', () => {
  it('accumulatePhase integrates the frequency track', () => {
    const phase = accumulatePhase(new Float64Array(1000).fill(100), 1000);
    expect(phase[0]).toBe(0);
    expect(phase[10]).toBeCloseTo(1, 9);
    expect(phase[999]).toBeCloseTo(99.9, 6);
  });

  it('closeLoop makes the total phase a whole number of cycles', () => {
    const track = new Float64Array(1000).fill(110.3);
    const open = accumulatePhase(track, 1000);
    const closed = accumulatePhase(track, 1000, true);
    const wrapOpen = (open[999] as number) + 0.1103 - (open[0] as number);
    const wrapClosed = (closed[999] as number) + ((closed[1] as number) - (closed[0] as number));
    expect(Math.abs(wrapOpen - Math.round(wrapOpen))).toBeGreaterThan(0.01);
    expect(Math.abs(wrapClosed - Math.round(wrapClosed))).toBeLessThan(1e-9);
  });

  it('sawAt and squareAt match the explicit harmonic sums', () => {
    const phase = 0.137;
    let saw = 0;
    let square = 0;
    for (let k = 1; k <= 6; k++) saw += Math.sin(2 * Math.PI * k * phase) / k;
    for (const k of [1, 3, 5]) square += Math.sin(2 * Math.PI * k * phase) / k;
    expect(sawAt(phase, 100, 48000, 6)).toBeCloseTo(saw * (2 / Math.PI), 9);
    expect(squareAt(phase, 100, 48000, 6)).toBeCloseTo(square * (4 / Math.PI), 9);
  });

  it('stops adding harmonics at Nyquist and never drops below the fundamental', () => {
    const phase = 0.21;
    const nearNyquist = sawAt(phase, 3900, 8000, 8);
    expect(nearNyquist).toBeCloseTo(Math.sin(2 * Math.PI * phase) * (2 / Math.PI), 9);
    expect(Number.isFinite(sawAt(phase, 1e6, 8000, 8))).toBe(true);
  });

  it('loopSine repeats exactly after the loop length for whole cycles', () => {
    expect(loopSine(0, 1000, 3, 0.2)).toBeCloseTo(loopSine(1000, 1000, 3, 0.2), 9);
    expect(loopSine(250, 1000, 1)).toBeCloseTo(1, 9);
  });
});

describe('mix', () => {
  it('saturate keeps unity at +-1, is odd and warms mid-level input', () => {
    expect(saturate(1, 2)).toBeCloseTo(1, 9);
    expect(saturate(-0.3, 2)).toBeCloseTo(-saturate(0.3, 2), 9);
    expect(saturate(0.3, 3)).toBeGreaterThan(0.3);
  });

  it('mixInto adds with gain at an offset and clips at both ends', () => {
    const target = new Float32Array(5);
    mixInto(target, [1, 1, 1], 0.5, 3);
    mixInto(target, [1, 1, 1], 1, -1);
    expect(Array.from(target)).toEqual([1, 1, 0, 0.5, 0.5]);
  });

  it('mixIntoCircular wraps past the end', () => {
    const target = new Float32Array(4);
    mixIntoCircular(target, [1, 2, 3], 1, 3);
    expect(Array.from(target)).toEqual([2, 3, 0, 1]);
  });

  it('dbToGain converts decibels to linear gain', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 9);
    expect(toDb(dbToGain(-6) ** 2)).toBeCloseTo(-6, 6);
    expect(goertzelPower(sine(100, 0.5), SR, 100)).toBeGreaterThan(goertzelPower(sine(100, 0.5), SR, 300) * 1000);
  });
});
