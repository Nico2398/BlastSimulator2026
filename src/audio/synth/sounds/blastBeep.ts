// BlastSimulator2026 — Evacuation tick
// A detuned square/saw pair with a sub-octave body and a tiny noise click, lowpassed so it is
// firm but not shrill.

import { BLAST_BEEP_CONFIG } from '../../../core/config/audio/synth.js';
import { finishRender } from '../finish.js';
import { Biquad } from '../filters.js';
import { whiteNoise } from '../noise.js';
import { sawAt, squareAt } from '../oscillators.js';
import { rngFor } from '../seed.js';
import type { SynthRecipe } from '../types.js';

const TWO_PI = 2 * Math.PI;

export const BLAST_BEEP: SynthRecipe = {
  variants: 1,
  loop: false,
  render() {
    const c = BLAST_BEEP_CONFIG;
    const sr = c.sampleRate;
    const n = Math.round(c.durationSec * sr);
    const noise = whiteNoise(rngFor('blast_beep', 0), n);
    const filter = new Biquad('lowpass', sr, c.lowpassHz);
    const detuned = c.noteHz * c.detuneRatio;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const rise = t < c.attackSec ? 0.5 - 0.5 * Math.cos((Math.PI * t) / c.attackSec) : 1;
      const fall = t > c.holdSec ? 0.5 + 0.5 * Math.cos((Math.PI * (t - c.holdSec)) / c.releaseSec) : 1;
      const sag = 1 - 0.2 * (t / c.holdSec);
      const tone =
        0.5 * squareAt(c.noteHz * t, c.noteHz, sr, c.harmonics) +
        0.5 * sawAt(detuned * t, detuned, sr, c.harmonics) +
        c.bodyGain * Math.sin(TWO_PI * (c.noteHz / 2) * t);
      const click = c.clickGain * (noise[i] as number) * Math.exp(-t / c.clickTauSec);
      out[i] = filter.tick((tone * sag + click) * rise * Math.max(0, fall));
    }
    return finishRender([out], sr, 'oneShot');
  },
};
