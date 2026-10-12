// BlastSimulator2026 — Thunder
// A bandpassed crackle front of a few hard bursts, then a lowpassed brown-noise rumble whose
// cutoff sweeps down under a multi-lobed envelope. Each variant is a different arrangement;
// the two channels use independent noise.

import { THUNDER_CONFIG } from '../../../core/config/audio/synth.js';
import { attackDecay, controlTrack, decayTo } from '../envelopes.js';
import { finishRender } from '../finish.js';
import { Biquad } from '../filters.js';
import { brownNoise, whiteNoise } from '../noise.js';
import { rngFor, variantAt, variantIndex } from '../seed.js';
import type { SynthRecipe } from '../types.js';

export const THUNDER: SynthRecipe = {
  variants: THUNDER_CONFIG.variants.length,
  loop: false,
  render(requested) {
    const c = THUNDER_CONFIG;
    const variant = variantIndex(c.variants.length, requested);
    const v = variantAt(c.variants, variant);
    const sr = c.sampleRate;
    const n = Math.round(v.durationSec * sr);
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < 2; ch++) {
      const rng = rngFor('thunder', variant, ch);
      const bursts = Array.from({ length: v.crackBursts }, (_, k) => ({
        at: k === 0 ? 0.004 : rng.nextFloat(0.02, v.crackSec),
        gain: k === 0 ? 1 : rng.nextFloat(0.25, 0.8),
        tau: rng.nextFloat(0.012, 0.05),
      }));
      const crackNoise = whiteNoise(rng, n);
      const rumbleNoise = brownNoise(rng, n, sr, 30);
      const crackFilter = new Biquad('bandpass', sr, v.crackCentreHz, c.crackQ);
      const rumbleFilter = new Biquad('lowpass', sr, v.startCutoffHz, c.filterQ);
      const crackLevel = controlTrack(n, (i) => {
        const t = i / sr;
        let env = 0;
        if (t < v.crackSec * 2.5) for (const b of bursts) env += b.gain * attackDecay(t - b.at, 0.001, b.tau);
        return c.crackGain * env;
      });
      const rumbleLevel = controlTrack(n, (i) => {
        const t = i / sr;
        let lobes = 0;
        for (const lobe of v.lobes) lobes += lobe.gain * attackDecay(t - lobe.atSec, lobe.riseSec, lobe.tauSec);
        return c.rumbleGain * lobes * Math.exp(-t / c.overallTauSec);
      });
      const cutoff = controlTrack(n, (i) => decayTo(v.startCutoffHz, c.endCutoffHz, i / sr, v.cutoffTauSec));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        out[i] = crackLevel(i) * crackFilter.tick(crackNoise[i] as number) + rumbleLevel(i) * rumbleFilter.tick(rumbleNoise[i] as number, cutoff(i));
      }
      channels.push(out);
    }
    return finishRender(channels, sr, 'oneShot');
  },
};
