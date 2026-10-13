// BlastSimulator2026 — synth recipes: does each sound have the spectral and temporal shape it is meant to?
// Nobody can listen in CI, so intent is checked with measurements: band energy (Goertzel), pitch
// tracks, envelopes and event statistics.

import { describe, expect, it } from 'vitest';
import { BLAST_SNAP_CONFIG, DEVICE_SOUNDS, SYNTH_LEVELS } from '../../../../src/core/config/audio/synth.js';
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

/** Level (dB) of a window of a render. */
const levelDb = (audio: RenderedAudio, from: number, to: number): number => rmsDb(windowOf(audio, from, to));

describe('reverse_beeper', () => {
  const audio = renderCached('reverse_beeper', 0);
  const { tones } = DEVICE_SOUNDS.reverse_beeper;

  it('beeps near 1.15 kHz, the pitch of a common backup alarm', () => {
    const beep = windowOf(audio, 0.1, 0.3);
    expect(dominantFrequency(beep, audio.sampleRate, 400, 4000, 10)).toBeGreaterThan(1100);
    expect(dominantFrequency(beep, audio.sampleRate, 400, 4000, 10)).toBeLessThan(1200);
  });

  it('is three beeps with silence between them, not a held tone', () => {
    expect(tones).toHaveLength(3);
    tones.slice(1).forEach((tone, k) => {
      const before = tones[k] as typeof tone;
      const gapStart = before.atSec + before.durSec;
      const off = levelDb(audio, gapStart + 0.1, tone.atSec - 0.1);
      for (const beep of [before, tone]) {
        expect(levelDb(audio, beep.atSec + 0.1, beep.atSec + beep.durSec - 0.1) - off, `gap before ${tone.atSec}`).toBeGreaterThan(30);
      }
    });
  });
});

describe('phone_ring', () => {
  const audio = renderCached('phone_ring', 0);

  it('trills: consecutive half-periods of the ringer sit on its two pitches', () => {
    const [ring] = DEVICE_SOUNDS.phone_ring.tones;
    if (ring?.trillHz === undefined) throw new Error('phone_ring needs a trilling tone');
    const half = 1 / (ring.trillHz * 2);
    const pitchOfHalf = (k: number): number => dominantFrequency(
      windowOf(audio, ring.atSec + k * half + 0.004, ring.atSec + (k + 1) * half - 0.004), audio.sampleRate, 800, 1600, 10,
    );
    for (const k of [2, 4, 6]) {
      expect(Math.abs(pitchOfHalf(k) - ring.hz), `half ${k}`).toBeLessThan(60);
      expect(Math.abs(pitchOfHalf(k + 1) - (ring.altHz ?? 0)), `half ${k + 1}`).toBeLessThan(60);
    }
  });

  it('rings twice with a gap', () => {
    expect(levelDb(audio, 0.1, 0.35) - levelDb(audio, 0.47, 0.57)).toBeGreaterThan(30);
    expect(levelDb(audio, 0.72, 0.97) - levelDb(audio, 0.47, 0.57)).toBeGreaterThan(30);
  });
});

describe('site radio', () => {
  it.each(['radio_order', 'radio_info', 'radio_good', 'radio_warn', 'radio_end'] as const)('%s sits in the radio band', (id) => {
    const audio = renderCached(id, 0);
    const x = audio.channels[0] as Float32Array;
    const band = bandPower(x, audio.sampleRate, 400, 2800, 20);
    expect(toDb(bandPower(x, audio.sampleRate, 40, 150, 5) / band)).toBeLessThan(-20);
    expect(toDb(bandPower(x, audio.sampleRate, 6000, 10000, 100) / band)).toBeLessThan(-20);
  });

  it('opens with an audible burst of broadband squelch hiss before the beep', () => {
    const audio = renderCached('radio_order', 0);
    const [first] = DEVICE_SOUNDS.radio_order.tones;
    if (!first) throw new Error('radio_order needs a tone');
    const hiss = windowOf(audio, 0.005, 0.04);
    expect(levelDb(audio, 0.005, 0.04)).toBeGreaterThan(levelDb(audio, first.atSec + 0.01, first.atSec + first.durSec - 0.01) - 12);
    expect(toDb(bandPower(hiss, audio.sampleRate, 1800, 2800, 20) / bandPower(hiss, audio.sampleRate, 400, 1400, 20))).toBeGreaterThan(-12);
  });

  it('acknowledges an order with two notes, the second higher', () => {
    const audio = renderCached('radio_order', 0);
    const [first, second] = DEVICE_SOUNDS.radio_order.tones;
    if (!first || !second) throw new Error('radio_order needs two tones');
    const pitch = (tone: typeof first): number => dominantFrequency(
      windowOf(audio, tone.atSec + 0.01, tone.atSec + tone.durSec - 0.01), audio.sampleRate, 600, 2400, 10,
    );
    expect(pitch(second)).toBeGreaterThan(pitch(first) * 1.2);
  });
});

describe('alarm_buzzer', () => {
  const audio = renderCached('alarm_buzzer', 0);

  it('rasps: a low buzz whose upper harmonics carry about as much energy as its fundamental', () => {
    const [buzzTone] = DEVICE_SOUNDS.alarm_buzzer.tones;
    if (!buzzTone) throw new Error('alarm_buzzer needs a tone');
    const buzz = windowOf(audio, 0.03, 0.17);
    const fundamental = goertzelPower(buzz, audio.sampleRate, buzzTone.hz);
    let harmonics = 0;
    for (let k = 3; k <= 15; k += 2) harmonics += goertzelPower(buzz, audio.sampleRate, buzzTone.hz * k);
    expect(dominantFrequency(buzz, audio.sampleRate, 100, 300, 5)).toBeCloseTo(buzzTone.hz, -1);
    expect(toDb(harmonics / fundamental)).toBeGreaterThan(-6);
  });
});

describe('instrument_beep', () => {
  it('is a high piezo beep near 2.7 kHz', () => {
    const audio = renderCached('instrument_beep', 0);
    const beep = windowOf(audio, 0.01, 0.05);
    expect(dominantFrequency(beep, audio.sampleRate, 1000, 5000, 20)).toBeGreaterThan(2600);
    expect(dominantFrequency(beep, audio.sampleRate, 1000, 5000, 20)).toBeLessThan(2800);
  });
});
