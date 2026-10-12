// BlastSimulator2026 — outdoor reverb impulse response

import { describe, expect, it } from 'vitest';
import { renderReverbIr } from '../../../../src/audio/synth/recipes.js';
import { REVERB_CONFIG } from '../../../../src/core/config/audio/synth.js';
import { bandPower, reverbCached, sameSamples, toDb, windowOf } from './helpers.js';

describe('renderReverbIr', () => {
  const ir = reverbCached();

  it('is a stereo, finite, ~2.4 s response', () => {
    expect(ir.channels.length).toBe(2);
    expect(ir.channels[0]?.length).toBe(ir.channels[1]?.length);
    expect(ir.channels[0]?.length).toBe(Math.round(REVERB_CONFIG.durationSec * ir.sampleRate));
    expect(ir.channels.every((c) => c.every((v) => Number.isFinite(v)))).toBe(true);
  });

  it('is deterministic', () => {
    expect(sameSamples(renderReverbIr(), ir)).toBe(true);
  });

  it('has unit energy in each channel', () => {
    for (const channel of ir.channels) {
      let energy = 0;
      for (const v of channel) energy += v * v;
      expect(energy).toBeCloseTo(1, 4);
    }
  });

  it('has decorrelated channels', () => {
    const [a, b] = ir.channels as [Float32Array, Float32Array];
    let cross = 0;
    for (let i = 0; i < a.length; i++) cross += (a[i] as number) * (b[i] as number);
    expect(Math.abs(cross)).toBeLessThan(0.1);
  });

  it('decays at about the configured RT60 (60 dB per 1.8 s, a little faster as the highs die) and is gone by the end', () => {
    const level = (from: number, to: number): number => {
      const w = windowOf(ir, from, to);
      return 10 * Math.log10(w.reduce((s, v) => s + v * v, 0) / w.length);
    };
    const drop = level(0.1, 0.2) - level(1.7, 1.8);
    // 1.6 s between the two windows: 53 dB at RT60 1.8 s
    expect(drop).toBeGreaterThan(45);
    expect(drop).toBeLessThan(65);
    expect(level(2.3, 2.4)).toBeLessThan(level(0.1, 0.2) - 60);
  });

  it('has sparse early reflections between 15 and 120 ms, before the diffuse tail takes over', () => {
    const [a] = ir.channels as [Float32Array];
    const sr = ir.sampleRate;
    expect(Math.max(...a.subarray(0, Math.round(0.014 * sr)).map(Math.abs))).toBe(0);
    const earlyPeak = Math.max(...a.subarray(Math.round(0.015 * sr), Math.round(0.12 * sr)).map(Math.abs));
    const latePeak = Math.max(...a.subarray(Math.round(1.5 * sr), Math.round(2.4 * sr)).map(Math.abs));
    expect(earlyPeak).toBeGreaterThan(latePeak * 5);
  });

  it('loses its highs faster than its lows', () => {
    const ratio = (from: number, to: number): number => {
      const w = windowOf(ir, from, to);
      return toDb(bandPower(w, ir.sampleRate, 5000, 11000, 200) / bandPower(w, ir.sampleRate, 200, 1000, 50));
    };
    expect(ratio(1.2, 1.8)).toBeLessThan(ratio(0.1, 0.4) - 8);
  });
});
