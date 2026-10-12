// BlastSimulator2026 — Blast sub-bass thump
// Falling-pitch sine with a quieter second harmonic and a sub-100 Hz noise body, warmed by
// tanh saturation, under a short lowpassed noise crack.

import { BLAST_SUB_CONFIG } from '../../../core/config/audio/synth.js';
import { attackDecay } from '../envelopes.js';
import { finishRender } from '../finish.js';
import { filterBuffer } from '../filters.js';
import { saturate } from '../mix.js';
import { unitRms, whiteNoise } from '../noise.js';
import { accumulatePhase } from '../oscillators.js';
import { rngFor, variantAt, variantIndex } from '../seed.js';
import type { SynthRecipe } from '../types.js';

const TWO_PI = 2 * Math.PI;

export const BLAST_SUB: SynthRecipe = {
  variants: BLAST_SUB_CONFIG.variants.length,
  loop: false,
  render(requested) {
    const c = BLAST_SUB_CONFIG;
    const variant = variantIndex(c.variants.length, requested);
    const v = variantAt(c.variants, variant);
    const sr = c.sampleRate;
    const n = Math.round(c.durationSec * sr);
    const rng = rngFor('blast_sub', variant);

    const pitch = new Float64Array(n);
    for (let i = 0; i < n; i++) pitch[i] = c.endHz + (v.startHz - c.endHz) * Math.exp(-i / sr / v.pitchTauSec);
    const phase = accumulatePhase(pitch, sr);

    const rumble = unitRms(filterBuffer(whiteNoise(rng, n), 'lowpass', sr, c.rumbleLowpassHz));
    const crack = unitRms(filterBuffer(whiteNoise(rng, n), 'lowpass', sr, c.transientLowpassHz, 0.9));

    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const cycles = phase[i] as number;
      const tone = (Math.sin(TWO_PI * (cycles + v.startPhase)) + c.secondHarmonicGain * Math.sin(TWO_PI * (2 * cycles + v.secondPhase))) * attackDecay(t, c.attackSec, c.decayTauSec);
      const body = c.rumbleGain * (rumble[i] as number) * attackDecay(t, 0.01, c.rumbleTauSec);
      const thump = saturate(tone + body, c.drive);
      out[i] = thump + c.transientGain * (crack[i] as number) * attackDecay(t, 0.0008, c.transientTauSec);
    }
    return finishRender([out], sr, 'oneShot');
  },
};
