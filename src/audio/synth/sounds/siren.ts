// BlastSimulator2026 — Blast siren loop
// Industrial klaxon: two slightly detuned band-limited sawtooths gliding on a smooth
// once-per-loop sweep with a gentle vibrato, plus a breath of noise, lowpassed and given a
// short echo for room feel. Phase tracks are closed to a whole cycle count so the wave
// wraps cleanly; the filter and echo are lap-settled.

import { SIREN_CONFIG } from '../../../core/config/audio/synth.js';
import { finishRender } from '../finish.js';
import { Biquad } from '../filters.js';
import { settleLoop } from '../loop.js';
import { whiteNoise } from '../noise.js';
import { accumulatePhase, loopSine, sawAt, TWO_PI } from '../oscillators.js';
import { rngFor } from '../seed.js';
import type { SynthRecipe } from '../types.js';

export const SIREN_LOOP: SynthRecipe = {
  variants: 1,
  loop: true,
  render() {
    const c = SIREN_CONFIG;
    const sr = c.sampleRate;
    const n = Math.round(c.durationSec * sr);
    const pitch = new Float64Array(n);
    const detuned = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const sweep = 0.5 - 0.5 * Math.cos((TWO_PI * i) / n);
      const f = (c.lowHz + (c.highHz - c.lowHz) * sweep) * (1 + c.vibratoDepth * loopSine(i, n, c.vibratoCycles));
      pitch[i] = f;
      detuned[i] = f * c.detuneRatio;
    }
    const phaseA = accumulatePhase(pitch, sr, true);
    const phaseB = accumulatePhase(detuned, sr, true);
    const breath = new Biquad('bandpass', sr, c.breathHz, 1.2);
    const noise = whiteNoise(rngFor('siren_loop', 0), n);
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      raw[i] =
        sawAt(phaseA[i] as number, pitch[i] as number, sr, c.harmonics) +
        c.secondSawGain * sawAt(phaseB[i] as number, detuned[i] as number, sr, c.harmonics);
    }
    const lowpass = new Biquad('lowpass', sr, c.lowpassHz);
    const delay = Math.round(c.echoDelaySec * sr);
    const echo = new Float32Array(delay);
    let written = 0;
    const out = settleLoop(n, sr, (i) => {
      const dry = lowpass.tick((raw[i] as number) + c.breathGain * breath.tick(noise[i] as number));
      const slot = written++ % delay;
      const wet = dry + c.echoGain * (echo[slot] as number);
      echo[slot] = wet;
      return wet;
    });
    return finishRender([out], sr, 'loop');
  },
};
