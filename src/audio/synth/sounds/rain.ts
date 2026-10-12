// BlastSimulator2026 — Rain beds
// Shaped broadband hiss, a low patter band and (when heavy) a roar, with sparse resonant
// droplet pings panned across the stereo field. Noise is lap-settled and droplets wrap
// around the loop end, so the bed has no seam.

import { RAIN_HEAVY_CONFIG, RAIN_LIGHT_CONFIG, type RainConfig } from '../../../core/config/audio/synth.js';
import { controlTrack } from '../envelopes.js';
import { finishRender } from '../finish.js';
import { Biquad } from '../filters.js';
import { settleLoop } from '../loop.js';
import { mixIntoCircular } from '../mix.js';
import { whiteNoise } from '../noise.js';
import { loopSine } from '../oscillators.js';
import { rngFor } from '../seed.js';
import type { SynthRecipe } from '../types.js';
import type { Random } from '../../../core/math/Random.js';

/** Damped resonator impulse response by recurrence, no trig per sample. */
function ping(sampleRate: number, freqHz: number, tauSec: number): Float32Array {
  const samples = new Float32Array(Math.ceil(5 * tauSec * sampleRate));
  const radius = Math.exp(-1 / (tauSec * sampleRate));
  const omega = (2 * Math.PI * freqHz) / sampleRate;
  const feedback = 2 * radius * Math.cos(omega);
  let y1 = radius * Math.sin(omega);
  let y2 = 0;
  samples[0] = 0;
  if (samples.length > 1) samples[1] = y1;
  for (let i = 2; i < samples.length; i++) {
    const y = feedback * y1 - radius * radius * y2;
    samples[i] = y;
    y2 = y1;
    y1 = y;
  }
  return samples;
}

function droplets(c: RainConfig, rng: Random, length: number): readonly [Float32Array, Float32Array] {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const count = Math.round(c.dropletsPerSec * c.durationSec);
  for (let k = 0; k < count; k++) {
    const drop = ping(c.sampleRate, rng.nextFloat(c.dropletHz.min, c.dropletHz.max), rng.nextFloat(c.dropletTauSec.min, c.dropletTauSec.max));
    const gain = c.dropletGain * rng.next() ** 2;
    const pan = (rng.next() * Math.PI) / 2;
    const at = rng.nextInt(0, length - 1);
    mixIntoCircular(left, drop, gain * Math.cos(pan), at);
    mixIntoCircular(right, drop, gain * Math.sin(pan), at);
  }
  return [left, right];
}

function rainRecipe(id: string, c: RainConfig): SynthRecipe {
  return {
    variants: 1,
    loop: true,
    render() {
      const sr = c.sampleRate;
      const n = Math.round(c.durationSec * sr);
      const drops = droplets(c, rngFor(id, 0, 99), n);
      const channels = [0, 1].map((ch) => {
        const rng = rngFor(id, 0, ch);
        const noise = whiteNoise(rng, n);
        const highpass = new Biquad('highpass', sr, c.hissHighpassHz);
        const lowpass = new Biquad('lowpass', sr, c.hissLowpassHz);
        const patter = new Biquad('bandpass', sr, c.patterHz, 0.9);
        const roar = new Biquad('bandpass', sr, c.roarHz, 0.7);
        const swellPhase = rng.next();
        const swellTrack = controlTrack(n, (i) => 1 + c.swellDepth * loopSine(i, n, c.swellCycles, swellPhase));
        const dropBuffer = drops[ch] as Float32Array;
        return settleLoop(n, sr, (i) => {
          const swell = swellTrack(i);
          const hiss = lowpass.tick(highpass.tick(noise[i] as number));
          return (
            swell * (c.hissGain * hiss + c.patterGain * 2 * patter.tick(noise[i] as number) + c.roarGain * 3 * roar.tick(noise[i] as number)) +
            (dropBuffer[i] as number)
          );
        });
      });
      return finishRender(channels, sr, 'loop');
    },
  };
}

export const RAIN_LIGHT_BED = rainRecipe('rain_light_bed', RAIN_LIGHT_CONFIG);
export const RAIN_HEAVY_BED = rainRecipe('rain_heavy_bed', RAIN_HEAVY_CONFIG);
