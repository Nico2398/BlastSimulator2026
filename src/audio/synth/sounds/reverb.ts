// BlastSimulator2026 — Outdoor reverb impulse response
// Sparse early reflections off the pit walls, then decorrelated noise decaying exponentially
// to -60 dB at RT60 while a sweeping lowpass makes the highs die first. Each channel is
// normalised to unit energy.

import { REVERB_CONFIG } from '../../../core/config/audio/synth.js';
import { Biquad } from '../filters.js';
import { whiteNoise } from '../noise.js';
import { rngFor } from '../seed.js';
import type { RenderedAudio } from '../types.js';

const REFLECTION_KERNEL = [0.25, 0.5, 0.25] as const;

export function renderOutdoorIr(): RenderedAudio {
  const c = REVERB_CONFIG;
  const sr = c.sampleRate;
  const n = Math.round(c.durationSec * sr);
  const decayPerSec = Math.log(1000) / c.rt60Sec;
  const channels = [0, 1].map((ch) => {
    const rng = rngFor('reverb_ir', 0, ch);
    const noise = whiteNoise(rng, n);
    const filter = new Biquad('lowpass', sr, c.startCutoffHz);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const rise = Math.min(1, Math.max(0, (t - c.lateStartSec) / c.lateRiseSec));
      const cutoff = c.endCutoffHz + (c.startCutoffHz - c.endCutoffHz) * Math.exp(-t / c.cutoffTauSec);
      out[i] = filter.tick(noise[i] as number, cutoff) * rise * Math.exp(-t * decayPerSec);
    }
    for (let k = 0; k < c.reflectionCount; k++) {
      const t = rng.nextFloat(c.reflectionWindowSec.min, c.reflectionWindowSec.max);
      const sign = rng.chance(0.5) ? 1 : -1;
      const gain = sign * c.reflectionGain * (1 - 0.6 * ((t - c.reflectionWindowSec.min) / (c.reflectionWindowSec.max - c.reflectionWindowSec.min))) * (0.6 + 0.4 * rng.next());
      const at = Math.round(t * sr);
      REFLECTION_KERNEL.forEach((weight, j) => {
        out[at + j - 1] = (out[at + j - 1] as number) + gain * weight * 2;
      });
    }
    let energy = 0;
    for (let i = 0; i < n; i++) energy += (out[i] as number) ** 2;
    const scale = 1 / Math.sqrt(energy);
    for (let i = 0; i < n; i++) out[i] = (out[i] as number) * scale;
    return out;
  });
  return { sampleRate: sr, channels };
}
