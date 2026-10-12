// BlastSimulator2026 — Blast snap
// The instantaneous onset of a shot, which the sampled crack and boom layers lack: a broadband
// crack that starts at full strength, a body punch (band noise plus a falling sine) and a bright
// sizzle behind it, peak-normalised and driven through tanh for edge.

import { BLAST_SNAP_CONFIG } from '../../../core/config/audio/synth.js';
import { attackDecay, decayTo } from '../envelopes.js';
import { filterBuffer } from '../filters.js';
import { finishRender } from '../finish.js';
import { saturate } from '../mix.js';
import { unitRms, whiteNoise } from '../noise.js';
import { accumulatePhase, TWO_PI } from '../oscillators.js';
import { rngFor, variantAt, variantIndex } from '../seed.js';
import type { SynthRecipe } from '../types.js';
import type { Random } from '../../../core/math/Random.js';

/** Unit-RMS white noise limited to the band between `lowHz` and `highHz`. */
function bandNoise(rng: Random, length: number, sampleRate: number, lowHz: number, highHz: number): Float32Array {
  return unitRms(filterBuffer(filterBuffer(whiteNoise(rng, length), 'highpass', sampleRate, lowHz), 'lowpass', sampleRate, highHz));
}

export const BLAST_SNAP: SynthRecipe = {
  variants: BLAST_SNAP_CONFIG.variants.length,
  loop: false,
  render(requested) {
    const c = BLAST_SNAP_CONFIG;
    const variant = variantIndex(c.variants.length, requested);
    const v = variantAt(c.variants, variant);
    const sr = c.sampleRate;
    const n = Math.round(c.durationSec * sr);
    const rng = rngFor('blast_snap', variant);

    const crack = bandNoise(rng, n, sr, c.crackHighpassHz, c.crackLowpassHz);
    const punch = bandNoise(rng, n, sr, c.bodyBandHz.low, c.bodyBandHz.high);
    const sizzle = bandNoise(rng, n, sr, c.sizzleBandHz.low, c.sizzleBandHz.high);

    const pitch = new Float64Array(n);
    for (let i = 0; i < n; i++) pitch[i] = decayTo(v.bodyStartHz, v.bodyEndHz, i / sr, c.bodyPitchTauSec);
    const phase = accumulatePhase(pitch, sr);

    const sum = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const sine = Math.sin(TWO_PI * (phase[i] as number)) * c.bodySineGain * attackDecay(t, 0, c.bodySineTauSec);
      const sample =
        (crack[i] as number) * attackDecay(t, 0, v.crackTauSec) +
        (punch[i] as number) * c.bodyNoiseGain * attackDecay(t, 0, c.bodyNoiseTauSec) +
        sine +
        (sizzle[i] as number) * c.sizzleGain * attackDecay(t, 0, c.sizzleTauSec);
      sum[i] = sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = saturate((sum[i] as number) / peak, c.drive);
    return finishRender([out], sr, 'oneShot', c.fadeInSec);
  },
};
