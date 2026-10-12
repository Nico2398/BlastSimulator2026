// Test helpers for the synth: spectral probes (Goertzel), windowing and cached renders.

import { SYNTH_RECIPES, renderReverbIr } from '../../../../src/audio/synth/recipes.js';
import type { RenderedAudio } from '../../../../src/audio/synth/types.js';
import type { SynthRecipeId } from '../../../../src/audio/SoundCatalog.js';

/** Power of `signal` at one frequency (Goertzel, Hann-windowed, normalised by length). */
export function goertzelPower(signal: ArrayLike<number>, sampleRate: number, frequencyHz: number): number {
  const n = signal.length;
  const omega = (2 * Math.PI * frequencyHz) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const windowed = (signal[i] as number) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    const s0 = windowed + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (n * n);
}

/** Mean Goertzel power over a frequency grid, i.e. a power density for the band. */
export function bandPower(signal: ArrayLike<number>, sampleRate: number, lowHz: number, highHz: number, stepHz: number): number {
  let sum = 0;
  let count = 0;
  for (let f = lowHz; f <= highHz; f += stepHz) {
    sum += goertzelPower(signal, sampleRate, f);
    count++;
  }
  return sum / count;
}

export function dominantFrequency(signal: ArrayLike<number>, sampleRate: number, lowHz: number, highHz: number, stepHz: number): number {
  let best = lowHz;
  let bestPower = -1;
  for (let f = lowHz; f <= highHz; f += stepHz) {
    const power = goertzelPower(signal, sampleRate, f);
    if (power > bestPower) {
      bestPower = power;
      best = f;
    }
  }
  return best;
}

export const toDb = (power: number): number => 10 * Math.log10(power + 1e-30);

export function windowOf(audio: RenderedAudio, fromSec: number, toSec: number, channel = 0): Float32Array {
  return (audio.channels[channel] as Float32Array).slice(Math.round(fromSec * audio.sampleRate), Math.round(toSec * audio.sampleRate));
}

const cache = new Map<string, RenderedAudio>();

export function renderCached(id: SynthRecipeId, variant: number): RenderedAudio {
  const key = `${id}#${variant}`;
  let audio = cache.get(key);
  if (audio === undefined) {
    audio = SYNTH_RECIPES[id].render(variant);
    cache.set(key, audio);
  }
  return audio;
}

let ir: RenderedAudio | undefined;
export function reverbCached(): RenderedAudio {
  ir ??= renderReverbIr();
  return ir;
}

export function sameSamples(a: RenderedAudio, b: RenderedAudio): boolean {
  if (a.channels.length !== b.channels.length) return false;
  return a.channels.every((channel, c) => {
    const other = b.channels[c] as Float32Array;
    if (channel.length !== other.length) return false;
    for (let i = 0; i < channel.length; i++) if (channel[i] !== other[i]) return false;
    return true;
  });
}

/** Sorted |x[i] - x[i-1]| for one channel. */
export function sortedSteps(channel: Float32Array): number[] {
  const steps: number[] = [];
  for (let i = 1; i < channel.length; i++) steps.push(Math.abs((channel[i] as number) - (channel[i - 1] as number)));
  return steps.sort((a, b) => a - b);
}

/**
 * How far the strongest spectral line stands above its own neighbourhood (dB): about 8-14 for
 * noise of any colour, 25+ for a steady tone.
 */
export function maxLineProminenceDb(signal: ArrayLike<number>, sampleRate: number, lowHz: number, highHz: number, stepHz: number): number {
  const powers: number[] = [];
  for (let f = lowHz; f <= highHz; f += stepHz) powers.push(goertzelPower(signal, sampleRate, f));
  const span = 10;
  let worst = -Infinity;
  for (let i = span; i < powers.length - span; i++) {
    let sum = 0;
    let count = 0;
    for (let k = i - span; k <= i + span; k++) {
      if (Math.abs(k - i) <= 2) continue;
      sum += powers[k] as number;
      count++;
    }
    worst = Math.max(worst, toDb((powers[i] as number) / (sum / count)));
  }
  return worst;
}
