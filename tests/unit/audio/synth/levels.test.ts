// BlastSimulator2026 — synth level measurement, final shaping and loop construction

import { describe, expect, it } from 'vitest';
import { Random } from '../../../../src/core/math/Random.js';
import { SYNTH_LEVELS } from '../../../../src/core/config/audio/synth.js';
import { Biquad, filterBuffer } from '../../../../src/audio/synth/filters.js';
import { finishRender } from '../../../../src/audio/synth/finish.js';
import { settleLoop } from '../../../../src/audio/synth/loop.js';
import { dcOffset, gatedRmsDb, samplePeakDb, truePeakDb } from '../../../../src/audio/synth/loudness.js';
import { whiteNoise } from '../../../../src/audio/synth/noise.js';
import { sortedSteps } from './helpers.js';

const SR = 8000;

function sine(freq: number, seconds: number, amplitude = 1, phase = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SR + phase);
  return out;
}

describe('loudness', () => {
  it('gatedRmsDb of a sine is its amplitude minus 3 dB', () => {
    expect(gatedRmsDb([sine(200, 2, 0.5)], SR)).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1);
  });

  it('averages over all channels', () => {
    const loud = sine(200, 2, 0.5);
    expect(gatedRmsDb([loud, new Float32Array(loud.length)], SR)).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2) - 3.01, 1);
  });

  it('ignores gated-out silence so a long quiet tail does not dilute the level', () => {
    const tone = sine(200, 1, 0.5);
    const padded = new Float32Array(tone.length * 4);
    padded.set(tone);
    // frames straddling the tone's edge are diluted, but four seconds of silence (-7 dB) is not
    expect(Math.abs(gatedRmsDb([padded], SR) - gatedRmsDb([tone], SR))).toBeLessThan(1);
  });

  it('falls back to the whole signal when everything is below the gate and handles tiny or empty input', () => {
    const quiet = sine(200, 1, 10 ** (-70 / 20));
    expect(gatedRmsDb([quiet], SR)).toBeCloseTo(-70 - 3.01, 1);
    expect(gatedRmsDb([sine(200, 0.05, 0.5)], SR)).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 0);
    expect(gatedRmsDb([new Float32Array(0)], SR)).toBe(-200);
    expect(gatedRmsDb([], SR)).toBe(-200);
    expect(gatedRmsDb([new Float32Array(100)], SR)).toBe(-200);
  });

  it('samplePeakDb and dcOffset read the obvious values', () => {
    expect(samplePeakDb([Float32Array.from([0.1, -0.5, 0.2])])).toBeCloseTo(-6.02, 2);
    expect(samplePeakDb([new Float32Array(3)])).toBe(-200);
    expect(dcOffset([Float32Array.from([0.1, 0.1, 0.1])])).toBeCloseTo(0.1, 6);
    expect(dcOffset([])).toBe(0);
    expect(dcOffset([new Float32Array(0)])).toBe(0);
  });

  it('truePeakDb sees inter-sample peaks a sample scan misses', () => {
    const sampled = sine(SR / 4, 0.1, 1, Math.PI / 4);
    expect(samplePeakDb([sampled])).toBeCloseTo(-3.01, 1);
    expect(truePeakDb([sampled])).toBeGreaterThan(-0.2);
  });
});

describe('finishRender', () => {
  const noiseBurst = (seconds: number): Float32Array => {
    const noise = filterBuffer(whiteNoise(new Random(3), Math.round(seconds * SR)), 'lowpass', SR, 800);
    return noise.map((v, i) => v * Math.exp(-i / SR / 0.3) + 0.2);
  };

  it('one-shots land on the one-shot level, lose DC and fade at both ends', () => {
    const { channels, sampleRate } = finishRender([noiseBurst(1.5)], SR, 'oneShot');
    expect(sampleRate).toBe(SR);
    const out = channels[0] as Float32Array;
    expect(gatedRmsDb(channels, SR)).toBeCloseTo(SYNTH_LEVELS.oneShotDb, 1);
    expect(Math.abs(dcOffset(channels))).toBeLessThan(1e-3);
    expect(out[0]).toBe(0);
    expect(Math.abs(out[out.length - 1] as number)).toBeLessThan(1e-3);
  });

  it('a one-shot may ask for a shorter fade-in, which keeps its onset', () => {
    const burst = Float32Array.from({ length: Math.round(SR * 0.5) }, (_, i) => Math.exp(-i / SR / 0.05) * (i % 2 === 0 ? 1 : -1));
    const first = (fadeInSec?: number): number => {
      const out = finishRender([burst], SR, 'oneShot', fadeInSec).channels[0] as Float32Array;
      return Math.abs(out[Math.round(0.0005 * SR)] as number) / Math.max(...out.map(Math.abs));
    };
    expect(first(0.0001)).toBeGreaterThan(0.9);
    expect(first(SYNTH_LEVELS.fadeInSec)).toBeLessThan(0.3);
    expect(first()).toBeCloseTo(first(SYNTH_LEVELS.fadeInSec), 6);
  });

  it('loops land on the loop level and keep their first sample (no fades)', () => {
    const cosine = sine(100, 2, 0.7, Math.PI / 2);
    const { channels } = finishRender([cosine], SR, 'loop');
    expect(gatedRmsDb(channels, SR)).toBeCloseTo(SYNTH_LEVELS.loopDb, 1);
    expect(Math.abs((channels[0] as Float32Array)[0] as number)).toBeGreaterThan(0.01);
  });

  it('applies one gain to every channel so the stereo balance survives', () => {
    const left = sine(150, 1, 0.8);
    const right = sine(150, 1, 0.4);
    const { channels } = finishRender([left, right], SR, 'loop');
    const ratio = Math.abs((channels[0] as Float32Array)[40] as number) / Math.abs((channels[1] as Float32Array)[40] as number);
    expect(ratio).toBeCloseTo(2, 3);
  });

  it('lets the true-peak ceiling win over the level target for wideband noise', () => {
    const white = whiteNoise(new Random(3), SR).map((v, i) => v * Math.exp(-i / SR / 0.3));
    const { channels } = finishRender([white], SR, 'oneShot');
    expect(truePeakDb(channels)).toBeLessThanOrEqual(SYNTH_LEVELS.peakCeilingDb + 1e-6);
    expect(gatedRmsDb(channels, SR)).toBeLessThanOrEqual(SYNTH_LEVELS.oneShotDb + 0.1);
  });

  it('holds spiky material under the peak ceiling, true peak included', () => {
    const spiky = new Float32Array(SR);
    spiky.set(whiteNoise(new Random(9), SR).map((v) => v * 0.02));
    spiky[1000] = 1;
    spiky[1001] = -1;
    const { channels } = finishRender([spiky], SR, 'oneShot');
    expect(truePeakDb(channels)).toBeLessThanOrEqual(SYNTH_LEVELS.peakCeilingDb + 1e-6);
  });

  it('trims an inter-sample overshoot that the sample limiter cannot see', () => {
    const { channels } = finishRender([sine(SR / 4, 1, 1, Math.PI / 4)], SR, 'loop');
    expect(truePeakDb(channels)).toBeLessThanOrEqual(SYNTH_LEVELS.peakCeilingDb + 1e-6);
  });

  it('leaves silence silent and never produces NaN', () => {
    const { channels } = finishRender([new Float32Array(100)], SR, 'oneShot');
    expect(Array.from(channels[0] as Float32Array).every((v) => v === 0)).toBe(true);
  });

  it('does not modify its input', () => {
    const input = noiseBurst(0.5);
    const copy = Float32Array.from(input);
    finishRender([input], SR, 'oneShot');
    expect(Array.from(input)).toEqual(Array.from(copy));
  });
});

describe('settleLoop', () => {
  it('returns the requested length and pre-runs only the warm-up stretch', () => {
    let calls = 0;
    const out = settleLoop(SR * 2, SR, (i) => {
      calls++;
      return i;
    });
    expect(out.length).toBe(SR * 2);
    expect(calls).toBe(SR * 2 + Math.round(SYNTH_LEVELS.loopWarmupSec * SR));
    expect(out[5]).toBe(5);
  });

  it('caps the warm-up at the loop length', () => {
    let calls = 0;
    settleLoop(100, SR, () => {
      calls++;
      return 0;
    });
    expect(calls).toBe(200);
  });

  it('wraps seamlessly where a plain single pass leaves a jump', () => {
    const n = SR;
    const period = n / 5;
    const wave = (i: number): number => ((i % period) / period) * 2 - 1;
    const build = (settle: boolean): Float32Array => {
      const filter = new Biquad('lowpass', SR, 120, 2);
      const step = (i: number): number => filter.tick(wave(i));
      if (settle) return settleLoop(n, SR, step);
      return Float32Array.from({ length: n }, (_, i) => step(i));
    };
    const wrap = (x: Float32Array): number => Math.abs((x[0] as number) - (x[x.length - 1] as number));
    const naive = build(false);
    const settled = build(true);
    const p99 = (x: Float32Array): number => {
      const steps = sortedSteps(x);
      return steps[Math.floor(steps.length * 0.99)] as number;
    };
    expect(wrap(naive)).toBeGreaterThan(p99(naive) * 5);
    expect(wrap(settled)).toBeLessThanOrEqual(p99(settled));
  });
});
