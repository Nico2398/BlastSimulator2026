// BlastSimulator2026 — Blast rolling rumble tail
// Brown noise through a lowpass that sweeps down as the blast recedes, rolled by three slow
// modulators, with sparse decaying debris ticks panned across the stereo field. Each
// channel has its own noise so the two are decorrelated.

import { BLAST_TAIL_CONFIG } from '../../../core/config/audio/synth.js';
import { attackDecay, controlTrack, decayTo } from '../envelopes.js';
import { finishRender } from '../finish.js';
import { Biquad } from '../filters.js';
import { mixInto } from '../mix.js';
import { brownNoise } from '../noise.js';
import { TWO_PI } from '../oscillators.js';
import { rngFor, variantIndex } from '../seed.js';
import type { SynthRecipe } from '../types.js';
import type { Random } from '../../../core/math/Random.js';

interface DebrisTick {
  readonly index: number;
  readonly samples: Float32Array;
  readonly pan: number;
}

function debrisTicks(rng: Random, sampleRate: number, length: number): DebrisTick[] {
  const d = BLAST_TAIL_CONFIG.debris;
  const ticks: DebrisTick[] = [];
  let t = 0;
  for (;;) {
    t += -Math.log(1 - rng.next()) / (d.startRate * Math.exp(-t / d.tauSec));
    const index = Math.round(t * sampleRate);
    if (index >= length) return ticks;
    const freq = rng.nextFloat(d.freqHz.min, d.freqHz.max);
    const tau = rng.nextFloat(d.ringTauSec.min, d.ringTauSec.max);
    const amplitude = d.gain * rng.next() ** 2 * Math.exp(-t / d.tauSec);
    const samples = new Float32Array(Math.ceil(5 * tau * sampleRate));
    for (let k = 0; k < samples.length; k++) {
      const s = k / sampleRate;
      samples[k] = amplitude * Math.exp(-s / tau) * (0.7 * Math.sin(TWO_PI * freq * s) + 0.5 * (rng.next() * 2 - 1));
    }
    ticks.push({ index, samples, pan: rng.next() });
  }
}

export const BLAST_TAIL: SynthRecipe = {
  variants: BLAST_TAIL_CONFIG.variantCount,
  loop: false,
  render(requested) {
    const c = BLAST_TAIL_CONFIG;
    const variant = variantIndex(c.variantCount, requested);
    const sr = c.sampleRate;
    const n = Math.round(c.durationSec * sr);
    const ticks = debrisTicks(rngFor('blast_tail', variant, 99), sr, n);
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < 2; ch++) {
      const rng = rngFor('blast_tail', variant, ch);
      const noise = brownNoise(rng, n, sr, 25);
      const filter = new Biquad('lowpass', sr, c.startCutoffHz, c.filterQ);
      const lfos = [0, 1, 2].map(() => ({ hz: rng.nextFloat(c.rollLfoHz.min, c.rollLfoHz.max), phase: rng.next() * TWO_PI }));
      const cutoff = controlTrack(n, (i) => decayTo(c.startCutoffHz, c.endCutoffHz, i / sr, c.cutoffTauSec));
      const level = controlTrack(n, (i) => {
        const t = i / sr;
        let roll = 0;
        for (const lfo of lfos) roll += Math.sin(TWO_PI * lfo.hz * t + lfo.phase);
        return attackDecay(t, c.swellSec, c.decayTauSec) * (1 + (c.rollDepth * roll) / lfos.length);
      });
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = filter.tick(noise[i] as number, cutoff(i)) * level(i);
      for (const tick of ticks) mixInto(out, tick.samples, ch === 0 ? Math.cos((tick.pan * Math.PI) / 2) : Math.sin((tick.pan * Math.PI) / 2), tick.index);
      channels.push(out);
    }
    return finishRender(channels, sr, 'oneShot');
  },
};
