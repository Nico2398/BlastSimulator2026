// BlastSimulator2026 — Distant diesel idle loop
// Two detuned engine layers, each a train of uneven firings: timing and level jitter on every
// pulse, a four-stroke accent pattern, and a slow periodic rpm drift. Each pulse is a decaying
// low sine burst plus a noise thump; a quiet mid clatter follows the pulses. The loop holds a
// whole number of firings per layer and pulses wrap around the end.

import { MACHINERY_CONFIG } from '../../../core/config/audio/synth.js';
import { finishRender } from '../finish.js';
import { Biquad } from '../filters.js';
import { settleLoop } from '../loop.js';
import { mixIntoCircular } from '../mix.js';
import { whiteNoise } from '../noise.js';
import { TWO_PI } from '../oscillators.js';
import { rngFor } from '../seed.js';
import type { SynthRecipe } from '../types.js';
import type { Random } from '../../../core/math/Random.js';

type Layer = (typeof MACHINERY_CONFIG.layers)[number];

/** Sample positions of each firing: rate follows 1 + depth * sin(drift) and integrates to `firings` over the loop. */
function firingPositions(layer: Layer, length: number): number[] {
  const c = MACHINERY_CONFIG;
  const driftOmega = TWO_PI * layer.driftCycles;
  const phaseOffset = TWO_PI * layer.driftPhase;
  const positions: number[] = [];
  let next = 0;
  for (let i = 0; i < length && next < layer.firings; i++) {
    const u = i / length;
    const count = layer.firings * (u + (c.driftDepth / driftOmega) * (Math.cos(phaseOffset) - Math.cos(driftOmega * u + phaseOffset)));
    while (next < layer.firings && count >= next) {
      positions.push(i);
      next++;
    }
  }
  return positions;
}

function renderLayer(layer: Layer, rng: Random, sampleRate: number, length: number, pulses: Float32Array, gate: Float32Array): void {
  const c = MACHINERY_CONFIG;
  const period = length / layer.firings;
  const burstLength = Math.ceil(5 * c.pulseTauSec * sampleRate);
  const gateBurst = new Float32Array(burstLength);
  for (let s = 0; s < burstLength; s++) gateBurst[s] = Math.exp(-s / sampleRate / c.clatterBand.gateTauSec);
  const pulseDecay = Math.exp(-1 / (sampleRate * c.pulseTauSec));
  const thumpDecay = Math.exp(-1 / (sampleRate * c.thumpTauSec));
  firingPositions(layer, length).forEach((position, k) => {
    const at = (Math.round(position + rng.nextFloat(-c.timingJitter, c.timingJitter) * period) + length) % length;
    const level = layer.gain * (layer.pattern[k % layer.pattern.length] as number) * (1 + c.amplitudeJitter * (rng.next() * 2 - 1));
    const omega = (TWO_PI * rng.nextFloat(c.pulseHz.min, c.pulseHz.max)) / sampleRate;
    const stepCos = Math.cos(omega);
    const stepSin = Math.sin(omega);
    const burst = new Float32Array(burstLength);
    let sine = 0;
    let cosine = 1;
    let toneEnv = 1;
    let thumpEnv = c.thumpGain;
    for (let s = 0; s < burstLength; s++) {
      burst[s] = sine * toneEnv + thumpEnv * (rng.next() * 2 - 1);
      [sine, cosine] = [sine * stepCos + cosine * stepSin, cosine * stepCos - sine * stepSin];
      toneEnv *= pulseDecay;
      thumpEnv *= thumpDecay;
    }
    mixIntoCircular(pulses, burst, level, at);
    mixIntoCircular(gate, gateBurst, level, at);
  });
}

export const MACHINERY_BED: SynthRecipe = {
  variants: 1,
  loop: true,
  render() {
    const c = MACHINERY_CONFIG;
    const sr = c.sampleRate;
    const n = Math.round(c.durationSec * sr);
    const pulses = new Float32Array(n);
    const gate = new Float32Array(n);
    c.layers.forEach((layer, index) => renderLayer(layer, rngFor('machinery_bed', 0, index), sr, n, pulses, gate));
    const noise = whiteNoise(rngFor('machinery_bed', 0, 50), n);
    const centre = Math.sqrt(c.clatterBand.lowHz * c.clatterBand.highHz);
    const clatter = new Biquad('bandpass', sr, centre, centre / (c.clatterBand.highHz - c.clatterBand.lowHz));
    const lowA = new Biquad('lowpass', sr, c.lowpassHz);
    const lowB = new Biquad('lowpass', sr, c.lowpassHz);
    const out = settleLoop(n, sr, (i) =>
      lowB.tick(lowA.tick(pulses[i] as number)) + c.clatterBand.gain * Math.min(1, gate[i] as number) * 6 * clatter.tick(noise[i] as number),
    );
    return finishRender([out], sr, 'loop');
  },
};
