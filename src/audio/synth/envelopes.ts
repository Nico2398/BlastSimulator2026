// BlastSimulator2026 — Envelope shapes

import { SYNTH_LEVELS } from '../../core/config/audio/synth.js';

/** Raised-cosine rise over `attackSec`, then exponential decay with time constant `tauSec`. 0 before t = 0. */
export function attackDecay(t: number, attackSec: number, tauSec: number): number {
  if (t < 0) return 0;
  const rise = t >= attackSec ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * t) / attackSec);
  return rise * Math.exp(-t / tauSec);
}

/** Exponential approach from `start` at t = 0 toward `end`, with time constant `tauSec`. */
export function decayTo(start: number, end: number, t: number, tauSec: number): number {
  return end + (start - end) * Math.exp(-t / tauSec);
}

/** Raised-cosine fade in and out applied in place. */
export function fadeEdges(samples: Float32Array, sampleRate: number, fadeInSec: number, fadeOutSec: number): void {
  const inLen = Math.min(samples.length, Math.round(fadeInSec * sampleRate));
  const outLen = Math.min(samples.length, Math.round(fadeOutSec * sampleRate));
  for (let i = 0; i < inLen; i++) {
    samples[i] = (samples[i] as number) * (0.5 - 0.5 * Math.cos((Math.PI * i) / inLen));
  }
  for (let i = 0; i < outLen; i++) {
    const at = samples.length - 1 - i;
    samples[at] = (samples[at] as number) * (0.5 - 0.5 * Math.cos((Math.PI * i) / outLen));
  }
}

/**
 * A slow parameter sampled every `envelopeControlInterval` samples and held in between, so
 * expensive curves (several exp/sin per sample) are evaluated at control rate.
 */
export function controlTrack(length: number, curve: (index: number) => number): (index: number) => number {
  const interval = SYNTH_LEVELS.envelopeControlInterval;
  const values = new Float32Array(Math.ceil(length / interval) + 1);
  for (let k = 0; k < values.length; k++) values[k] = curve(k * interval);
  return (index) => values[(index / interval) | 0] as number;
}
