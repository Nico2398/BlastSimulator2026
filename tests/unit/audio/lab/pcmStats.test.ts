// BlastSimulator2026 — PCM statistics and loudness
// Checked against signals whose level is known by construction.

import { describe, expect, it } from 'vitest';
import { measurePcm } from '../../../../src/audio/lab/pcmStats.js';
import { measureLoudness } from '../../../../src/audio/lab/loudness.js';
import { amplitudeToDb, powerToDb, roundDb } from '../../../../src/audio/lab/levels.js';
import { concat, dbToAmplitude, silence, sine, square } from './signals.js';

const SR = 48000;

describe('levels', () => {
  it('converts amplitude and power to dB and floors silence', () => {
    expect(amplitudeToDb(1)).toBe(0);
    expect(amplitudeToDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(powerToDb(0.01)).toBeCloseTo(-20, 5);
    expect(amplitudeToDb(0)).toBe(-120);
    expect(powerToDb(Number.NaN)).toBe(-120);
    expect(powerToDb(1e-30)).toBe(-120);
  });

  it('rounds to a tenth of a dB', () => {
    expect(roundDb(-3.0103)).toBe(-3);
    expect(roundDb(-12.349)).toBe(-12.3);
  });
});

describe('measurePcm on a sine of known level', () => {
  const amplitude = dbToAmplitude(-12);
  const left = sine(1000, amplitude, 5, SR);
  const stats = measurePcm([left, left], SR);

  it('reads peak, RMS and crest factor', () => {
    expect(stats.peakDbfs).toBeCloseTo(-12, 1);
    // a sine's RMS is 3.01 dB under its peak
    expect(stats.rmsDbfs).toBeCloseTo(-15.0, 1);
    expect(stats.gatedRmsDbfs).toBeCloseTo(-15.0, 1);
    expect(stats.crestFactorDb).toBeCloseTo(3.0, 1);
  });

  it('finds no clipping, DC or non-finite samples and no mono loss', () => {
    expect(stats.clipCount).toBe(0);
    expect(stats.nonFiniteCount).toBe(0);
    expect(stats.dcOffset).toBeLessThan(1e-4);
    expect(stats.monoLossDb).toBe(0);
  });

  it('describes the signal and gives one envelope cell per second', () => {
    expect(stats.sampleRate).toBe(SR);
    expect(stats.channels).toBe(2);
    expect(stats.durationS).toBe(5);
    expect(stats.envelopeDbfs).toHaveLength(5);
    for (const cell of stats.envelopeDbfs) expect(cell).toBeCloseTo(-15, 1);
  });
});

describe('measurePcm on other signals', () => {
  it('counts every sample of a clipped square at the rail', () => {
    const stats = measurePcm([square(100, 1, 1, SR)], SR);
    expect(stats.clipCount).toBe(SR);
    expect(stats.peakDbfs).toBe(0);
    expect(stats.rmsDbfs).toBeCloseTo(0, 1);
    expect(stats.crestFactorDb).toBeCloseTo(0, 1);
  });

  it('reports silence as the floor, not minus infinity', () => {
    const stats = measurePcm([silence(2, SR), silence(2, SR)], SR);
    expect(stats.peakDbfs).toBe(-120);
    expect(stats.rmsDbfs).toBe(-120);
    expect(stats.gatedRmsDbfs).toBe(-120);
    expect(stats.integratedLufs).toBe(-120);
    expect(stats.shortTermMaxLufs).toBe(-120);
    expect(stats.clipCount).toBe(0);
    expect(Number.isFinite(stats.crestFactorDb)).toBe(true);
  });

  it('gates out silence so a quiet pause does not drag the RMS down', () => {
    const tone = sine(1000, dbToAmplitude(-12), 2, SR);
    const stats = measurePcm([concat(tone, silence(8, SR))], SR);
    // windows straddling the edge of the tone are still within the relative gate, so allow a few tenths
    expect(Math.abs(stats.gatedRmsDbfs + 15)).toBeLessThan(0.5);
    // averaged over the whole ten seconds the same signal is 7 dB lower
    expect(stats.rmsDbfs).toBeLessThan(-21);
  });

  it('measures a constant offset as DC', () => {
    const dc = new Float32Array(SR).fill(0.05);
    expect(measurePcm([dc], SR).dcOffset).toBeCloseTo(0.05, 5);
  });

  it('counts non-finite samples and ignores them in every other figure', () => {
    const tone = sine(1000, 0.25, 1, SR);
    tone[10] = Number.NaN;
    tone[11] = Number.POSITIVE_INFINITY;
    const stats = measurePcm([tone], SR);
    expect(stats.nonFiniteCount).toBe(2);
    expect(stats.peakDbfs).toBeCloseTo(-12, 1);
    expect(Number.isFinite(stats.rmsDbfs)).toBe(true);
  });

  it('shows out-of-phase content as a loss when folded to mono', () => {
    const tone = sine(500, 0.5, 2, SR);
    const inverted = tone.map(v => -v);
    const stats = measurePcm([tone, inverted], SR);
    expect(stats.monoLossDb).toBeGreaterThan(20);
  });

  it('copes with an empty signal', () => {
    const stats = measurePcm([], SR);
    expect(stats.durationS).toBe(0);
    expect(stats.rmsDbfs).toBe(-120);
    expect(stats.envelopeDbfs).toEqual([]);
  });

  it('uses a short last cell for a signal that is not a whole number of seconds', () => {
    expect(measurePcm([sine(1000, 0.5, 2.5, SR)], SR).envelopeDbfs).toHaveLength(3);
  });
});

describe('measureLoudness', () => {
  it('reads the BS.1770 reference: a 997 Hz sine at -20 dBFS in one channel is -23.0 LUFS', () => {
    const tone = sine(997, dbToAmplitude(-20), 10, SR);
    const loudness = measureLoudness([tone, silence(10, SR)], SR);
    expect(loudness.integratedLufs).toBeCloseTo(-23, 0);
    expect(loudness.shortTermMaxLufs).toBeCloseTo(-23, 0);
  });

  it('sums channels: the same tone in both is 3 dB louder', () => {
    const tone = sine(997, dbToAmplitude(-20), 10, SR);
    const one = measureLoudness([tone, silence(10, SR)], SR).integratedLufs;
    const both = measureLoudness([tone, tone], SR).integratedLufs;
    expect(both - one).toBeCloseTo(3.01, 1);
  });

  it('hears a bass tone quieter than a mid tone of the same level, as K-weighting says', () => {
    const level = dbToAmplitude(-20);
    const bass = measureLoudness([sine(40, level, 6, 44100)], 44100).integratedLufs;
    const mid = measureLoudness([sine(1000, level, 6, 44100)], 44100).integratedLufs;
    expect(bass).toBeLessThan(mid - 1);
  });

  it('finds the loudest 3 s window above the gated average of a signal that gets louder', () => {
    const quiet = sine(997, dbToAmplitude(-40), 6, SR);
    const loud = sine(997, dbToAmplitude(-20), 4, SR);
    const loudness = measureLoudness([concat(quiet, loud)], SR);
    expect(loudness.shortTermMaxLufs).toBeGreaterThan(loudness.integratedLufs);
    // one channel carrying the loud tone: -20 dBFS is -23 LUFS
    expect(loudness.shortTermMaxLufs).toBeCloseTo(-23, 0);
  });

  it('measures a signal shorter than the short-term window as a single window', () => {
    const loudness = measureLoudness([sine(997, dbToAmplitude(-20), 1, SR)], SR);
    expect(loudness.shortTermMaxLufs).toBeCloseTo(-23, 0);
  });
});
