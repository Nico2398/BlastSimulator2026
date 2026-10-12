// BlastSimulator2026 — synth recipes: does each sound have the spectral and temporal shape it is meant to?
// Nobody can listen in CI, so intent is checked with measurements: band energy (Goertzel), pitch
// tracks, envelopes and event statistics.

import { describe, expect, it } from 'vitest';
import { BLAST_SNAP_CONFIG, SYNTH_LEVELS } from '../../../../src/core/config/audio/synth.js';
import { filterBuffer } from '../../../../src/audio/synth/filters.js';
import type { RenderedAudio } from '../../../../src/audio/synth/types.js';
import { bandPower, dominantFrequency, goertzelPower, toDb, windowOf } from './helpers.js';
import { renderCached } from './helpers.js';

const rmsDb = (samples: ArrayLike<number>): number => {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += (samples[i] as number) ** 2;
  return 10 * Math.log10(sum / samples.length + 1e-20);
};

/** RMS (dB) of consecutive windows. */
function windowedDb(audio: RenderedAudio, windowSec: number, channel = 0): number[] {
  const x = audio.channels[channel] as Float32Array;
  const size = Math.round(windowSec * audio.sampleRate);
  const out: number[] = [];
  for (let start = 0; start + size <= x.length; start += size) out.push(rmsDb(x.subarray(start, start + size)));
  return out;
}

/** dB difference between the band power density of two bands over one window. */
function bandRatioDb(audio: RenderedAudio, from: number, to: number, a: [number, number, number], b: [number, number, number]): number {
  const w = windowOf(audio, from, to);
  return toDb(bandPower(w, audio.sampleRate, ...a) / bandPower(w, audio.sampleRate, ...b));
}

/** Spread of the loudest 4 ms windows over the typical one: how clicky a band is. */
function clickinessDb(samples: Float32Array, sampleRate: number): number {
  const size = Math.round(0.004 * sampleRate);
  const levels: number[] = [];
  for (let start = 0; start + size <= samples.length; start += size) levels.push(rmsDb(samples.subarray(start, start + size)));
  levels.sort((a, b) => a - b);
  return (levels[Math.floor(levels.length * 0.99)] as number) - (levels[levels.length >> 1] as number);
}

describe('blast_sub', () => {
  it.each([0, 1])('variant %i keeps its energy below ~150 Hz', (variant) => {
    const audio = renderCached('blast_sub', variant);
    expect(bandRatioDb(audio, 0, 2.2, [20, 150, 5], [300, 3000, 50])).toBeGreaterThan(30);
  });

  it.each([0, 1])('variant %i pitch falls from the strike to the tail', (variant) => {
    const audio = renderCached('blast_sub', variant);
    const early = dominantFrequency(windowOf(audio, 0.05, 0.3), audio.sampleRate, 20, 120, 2);
    const late = dominantFrequency(windowOf(audio, 1.5, 1.75), audio.sampleRate, 20, 120, 2);
    expect(early).toBeGreaterThan(late + 15);
    expect(late).toBeLessThan(45);
  });

  it('is loudest right after the strike and has decayed a lot by the end', () => {
    const levels = windowedDb(renderCached('blast_sub', 0), 0.25);
    expect(Math.max(...levels.slice(0, 2))).toBe(Math.max(...levels));
    expect((levels[levels.length - 1] as number) + 15).toBeLessThan(levels[0] as number);
  });

  it('variants differ in how fast the pitch drops', () => {
    const slow = renderCached('blast_sub', 0);
    const fast = renderCached('blast_sub', 1);
    const at = (a: RenderedAudio): number => dominantFrequency(windowOf(a, 0.3, 0.5), a.sampleRate, 20, 120, 1);
    expect(at(slow)).not.toBe(at(fast));
  });
});

describe('blast_snap', () => {
  const MS = 0.001;
  /** RMS (dB) of consecutive 1 ms windows over the first `count` milliseconds. */
  const earlyEnvelopeDb = (audio: RenderedAudio, count: number): number[] => {
    const size = Math.round(MS * audio.sampleRate);
    const x = audio.channels[0] as Float32Array;
    return Array.from({ length: count }, (_, k) => rmsDb(x.subarray(k * size, (k + 1) * size)));
  };

  it.each([0, 1])('variant %i is a half-second mono burst at 44.1 kHz', (variant) => {
    const audio = renderCached('blast_snap', variant);
    expect(audio.sampleRate).toBe(44100);
    expect(audio.channels).toHaveLength(1);
    expect((audio.channels[0] as Float32Array).length / audio.sampleRate).toBeCloseTo(0.5, 3);
  });

  it.each([0, 1])('variant %i has an instantaneous onset: its 1 ms RMS is within 3 dB of its maximum inside the first 3 ms', (variant) => {
    const audio = renderCached('blast_snap', variant);
    const whole = windowedDb(audio, MS);
    const within = Math.max(...earlyEnvelopeDb(audio, 3));
    expect(within).toBeGreaterThanOrEqual(Math.max(...whole) - 3);
  });

  it.each([0, 1])('variant %i reaches half of its peak within 0.3 ms and starts from silence, not a step', (variant) => {
    const audio = renderCached('blast_snap', variant);
    const x = audio.channels[0] as Float32Array;
    const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    let half = 0;
    while (Math.abs(x[half] as number) < peak / 2) half++;
    expect(half / audio.sampleRate).toBeLessThanOrEqual(0.0003);
    expect(x[0]).toBeCloseTo(0, 9);
    expect(BLAST_SNAP_CONFIG.fadeInSec).toBeLessThan(SYNTH_LEVELS.fadeInSec);
  });

  it.each([0, 1])('variant %i decays: the first 10 ms sit far above the 100 ms point and the tail', (variant) => {
    const levels = windowedDb(renderCached('blast_snap', variant), 0.01);
    expect(levels[0]).toBe(Math.max(...levels));
    expect((levels[10] as number) + 12).toBeLessThan(levels[0] as number);
    expect((levels[levels.length - 2] as number) + 30).toBeLessThan(levels[0] as number);
  });

  it.each([0, 1])('variant %i is a broadband crack: the first 30 ms carry far more 1-8 kHz energy than the last 200 ms', (variant) => {
    const audio = renderCached('blast_snap', variant);
    const crack = (from: number, to: number): number => toDb(bandPower(windowOf(audio, from, to), audio.sampleRate, 1000, 8000, 100));
    expect(crack(0, 0.03) - crack(0.3, 0.5)).toBeGreaterThan(30);
  });

  it.each([0, 1])('variant %i keeps a punch below 150 Hz and a sizzle brighter than the mid band after the crack', (variant) => {
    const audio = renderCached('blast_snap', variant);
    expect(dominantFrequency(windowOf(audio, 0.02, 0.12), audio.sampleRate, 40, 200, 2)).toBeLessThan(150);
    const density = (lo: number, hi: number, step: number): number => toDb(bandPower(windowOf(audio, 0.08, 0.2), audio.sampleRate, lo, hi, step));
    expect(density(3000, 9000, 100)).toBeGreaterThan(density(1000, 2000, 50) + 2);
  });

  it('is quiet above 16 kHz, where noise gives the worst inter-sample overshoot', () => {
    const audio = renderCached('blast_snap', 0);
    const x = windowOf(audio, 0, 0.03);
    expect(toDb(bandPower(x, audio.sampleRate, 17000, 21000, 200) / bandPower(x, audio.sampleRate, 1000, 8000, 100))).toBeLessThan(-6);
  });
});

describe('blast_tail', () => {
  const audio = renderCached('blast_tail', 0);

  it('is a low rumble, not a hiss', () => {
    expect(bandRatioDb(audio, 0.2, 4, [20, 400, 10], [2000, 6000, 100])).toBeGreaterThan(20);
  });

  it('swells in, then decays', () => {
    const x = audio.channels[0] as Float32Array;
    const attack = rmsDb(x.subarray(0, Math.round(0.05 * audio.sampleRate)));
    const peak = rmsDb(windowOf(audio, 0.25, 0.35));
    const end = rmsDb(windowOf(audio, 4, 4.5));
    expect(peak).toBeGreaterThan(attack + 10);
    expect(end).toBeLessThan(peak - 15);
  });

  it('darkens as it recedes: the filter sweep moves energy from 300-900 Hz toward the sub-bass', () => {
    const early = bandRatioDb(audio, 0.2, 1, [300, 900, 20], [20, 150, 5]);
    const late = bandRatioDb(audio, 3, 4, [300, 900, 20], [20, 150, 5]);
    expect(early).toBeGreaterThan(late + 8);
  });

  it('carries sparse debris clicks above the rumble', () => {
    const x = audio.channels[0] as Float32Array;
    const highs = filterBuffer(x.subarray(0, Math.round(1.5 * audio.sampleRate)), 'highpass', audio.sampleRate, 700);
    expect(clickinessDb(highs, audio.sampleRate)).toBeGreaterThan(6);
  });
});

describe('blast_beep', () => {
  const audio = renderCached('blast_beep', 0);
  const x = audio.channels[0] as Float32Array;

  it('is a short tick near 1.05 kHz', () => {
    expect(x.length / audio.sampleRate).toBeCloseTo(0.14, 2);
    expect(Math.abs(dominantFrequency(x, audio.sampleRate, 800, 1400, 5) - 1050)).toBeLessThanOrEqual(40);
  });

  it('is not a pure sine: odd harmonics carry real energy', () => {
    const fundamental = goertzelPower(x, audio.sampleRate, 1050);
    const third = goertzelPower(x, audio.sampleRate, 3150);
    expect(toDb(third / fundamental)).toBeGreaterThan(-15);
  });

  it('keeps its top end tamed (no energy above the 4 kHz lowpass to speak of)', () => {
    const fundamental = goertzelPower(x, audio.sampleRate, 1050);
    expect(toDb(bandPower(x, audio.sampleRate, 7000, 12000, 100) / fundamental)).toBeLessThan(-35);
  });

  it('rises in a few milliseconds and releases over ~25 ms', () => {
    const at = (ms: number): number => Math.abs(x[Math.round((ms / 1000) * audio.sampleRate)] as number);
    expect(at(0.3)).toBeLessThan(0.05);
    expect(rmsDb(x.subarray(Math.round(0.03 * audio.sampleRate), Math.round(0.1 * audio.sampleRate)))).toBeGreaterThan(rmsDb(x.subarray(x.length - 40)) + 10);
  });
});

describe('blast_cancel', () => {
  const audio = renderCached('blast_cancel', 0);

  it('glides down from about 880 Hz to about 587 Hz', () => {
    const first = dominantFrequency(windowOf(audio, 0.05, 0.19), audio.sampleRate, 500, 1000, 5);
    const second = dominantFrequency(windowOf(audio, 0.42, 0.58), audio.sampleRate, 500, 1000, 5);
    expect(Math.abs(first - 880)).toBeLessThanOrEqual(30);
    expect(Math.abs(second - 587)).toBeLessThanOrEqual(25);
  });

  it('keeps a soft tail after the second note', () => {
    const tail = rmsDb(windowOf(audio, 0.4, 0.5));
    const end = rmsDb(windowOf(audio, 0.56, 0.6));
    expect(end).toBeLessThan(tail - 3);
    expect(end).toBeGreaterThan(-90);
  });
});

describe('siren_loop', () => {
  const audio = renderCached('siren_loop', 0);

  it('wails: the pitch sweeps from ~520 Hz up to ~880 Hz and back across the loop', () => {
    const low = dominantFrequency(windowOf(audio, 0, 0.2), audio.sampleRate, 400, 1000, 5);
    const high = dominantFrequency(windowOf(audio, 1.5, 1.7), audio.sampleRate, 400, 1000, 5);
    const back = dominantFrequency(windowOf(audio, 3, 3.2), audio.sampleRate, 400, 1000, 5);
    expect(low).toBeLessThan(600);
    expect(high).toBeGreaterThan(820);
    expect(back).toBeLessThan(600);
  });

  it('holds a constant level through the sweep', () => {
    const levels = windowedDb(audio, 0.2);
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(3);
  });

  it('is a saw-like klaxon with harmonics, rolled off by the 3 kHz lowpass', () => {
    const w = windowOf(audio, 0, 0.2);
    const fundamental = goertzelPower(w, audio.sampleRate, 525);
    expect(toDb(goertzelPower(w, audio.sampleRate, 1050) / fundamental)).toBeGreaterThan(-12);
    expect(toDb(bandPower(w, audio.sampleRate, 6000, 10000, 100) / fundamental)).toBeLessThan(-40);
  });
});

describe('thunder', () => {
  it.each([0, 1, 2])('variant %i opens with a broadband crackle front', (variant) => {
    const audio = renderCached('thunder', variant);
    const front = windowOf(audio, 0, 0.4);
    const later = windowOf(audio, 2.5, 3.5);
    expect(toDb(bandPower(front, audio.sampleRate, 1200, 6000, 100)) - toDb(bandPower(later, audio.sampleRate, 1200, 6000, 100))).toBeGreaterThan(12);
  });

  it.each([0, 1, 2])('variant %i is dominated by a low rumble overall', (variant) => {
    const audio = renderCached('thunder', variant);
    expect(bandRatioDb(audio, 0.5, 5, [20, 300, 10], [1500, 5000, 100])).toBeGreaterThan(15);
  });

  it.each([0, 1, 2])('variant %i has several rolling lobes and a long fade', (variant) => {
    const audio = renderCached('thunder', variant);
    const levels = windowedDb(audio, 0.25);
    const lobes = levels.filter((v, i) => i > 0 && i < levels.length - 1 && v - (levels[i - 1] as number) >= 1.5 && v - (levels[i + 1] as number) >= 1.5);
    expect(lobes.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...levels.slice(-4))).toBeLessThan(Math.max(...levels) - 15);
  });
});

describe('wind_bed', () => {
  const audio = renderCached('wind_bed', 0);

  it('is low and mid air movement with almost nothing at the top', () => {
    expect(bandRatioDb(audio, 2, 6, [100, 1500, 10], [4000, 5000, 10])).toBeGreaterThan(30);
  });

  it('gusts slowly: one-second levels vary by a few dB without being static or wild', () => {
    const levels = windowedDb(audio, 1);
    const spread = Math.max(...levels) - Math.min(...levels);
    expect(spread).toBeGreaterThan(3);
    expect(spread).toBeLessThan(12);
  });
});

describe('rain beds', () => {
  const light = renderCached('rain_light_bed', 0);
  const heavy = renderCached('rain_heavy_bed', 0);

  it('light rain is mostly broadband hiss above 1 kHz', () => {
    expect(bandRatioDb(light, 2, 4, [1000, 9000, 100], [20, 150, 5])).toBeGreaterThan(8);
  });

  it('heavy rain adds a low roar relative to its hiss', () => {
    const roar = (a: RenderedAudio): number => bandRatioDb(a, 2, 4, [100, 300, 5], [2000, 8000, 100]);
    expect(roar(heavy)).toBeGreaterThan(roar(light) + 8);
  });

  it('light rain has distinct droplet pings standing out of the hiss', () => {
    const band = (a: RenderedAudio): Float32Array => filterBuffer(filterBuffer(a.channels[0] as Float32Array, 'highpass', a.sampleRate, 3000), 'lowpass', a.sampleRate, 7000);
    expect(clickinessDb(band(light), light.sampleRate)).toBeGreaterThan(10);
    expect(clickinessDb(band(light), light.sampleRate)).toBeGreaterThan(clickinessDb(band(heavy), heavy.sampleRate) + 4);
  });
});

describe('machinery_bed', () => {
  const audio = renderCached('machinery_bed', 0);
  const x = audio.channels[0] as Float32Array;

  it('is a low rumble with a quiet clatter on top', () => {
    expect(toDb(bandPower(x, audio.sampleRate, 20, 500, 5) / bandPower(x, audio.sampleRate, 4000, 8000, 100))).toBeGreaterThan(20);
  });

  it('is made of pulses, not a drone: short-window level varies strongly', () => {
    const size = Math.round(0.005 * audio.sampleRate);
    const levels: number[] = [];
    for (let start = 0; start + size <= x.length; start += size) levels.push(Math.sqrt(x.subarray(start, start + size).reduce((s, v) => s + v * v, 0) / size));
    const mean = levels.reduce((s, v) => s + v, 0) / levels.length;
    const sd = Math.sqrt(levels.reduce((s, v) => s + (v - mean) ** 2, 0) / levels.length);
    expect(sd / mean).toBeGreaterThan(0.4);
  });

  it('pulses at the firing rate: the level envelope has more energy at 20-27 Hz than at 6-14 Hz', () => {
    const size = Math.round(0.005 * audio.sampleRate);
    const levels: number[] = [];
    for (let start = 0; start + size <= x.length; start += size) levels.push(Math.sqrt(x.subarray(start, start + size).reduce((s, v) => s + v * v, 0) / size));
    const mean = levels.reduce((s, v) => s + v, 0) / levels.length;
    const envelope = Float32Array.from(levels, (v) => v - mean);
    expect(toDb(bandPower(envelope, 200, 20, 27, 0.25) / bandPower(envelope, 200, 6, 14, 0.25))).toBeGreaterThan(3);
  });
});
