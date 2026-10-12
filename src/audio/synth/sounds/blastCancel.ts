// BlastSimulator2026 — Evacuation cancelled
// A soft two-note power-down: a detuned sine pair with a couple of overtones gliding from
// 880 Hz to 587 Hz, the second note re-struck, then a few lowpassed echoes for the tail.

import { BLAST_CANCEL_CONFIG } from '../../../core/config/audio/synth.js';
import { attackDecay } from '../envelopes.js';
import { finishRender } from '../finish.js';
import { filterBuffer } from '../filters.js';
import { mixInto } from '../mix.js';
import { accumulatePhase } from '../oscillators.js';
import type { SynthRecipe } from '../types.js';

const TWO_PI = 2 * Math.PI;

export const BLAST_CANCEL: SynthRecipe = {
  variants: 1,
  loop: false,
  render() {
    const c = BLAST_CANCEL_CONFIG;
    const sr = c.sampleRate;
    const n = Math.round(c.durationSec * sr);
    const pitch = new Float64Array(n);
    const detuned = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const glide = Math.min(1, Math.max(0, (i / sr - c.firstSec) / c.glideSec));
      const f = c.firstHz + (c.secondHz - c.firstHz) * (0.5 - 0.5 * Math.cos(Math.PI * glide));
      pitch[i] = f;
      detuned[i] = f * c.detuneRatio;
    }
    const phaseA = accumulatePhase(pitch, sr);
    const phaseB = accumulatePhase(detuned, sr);
    const dry = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let tone = 0;
      for (const phase of [phaseA, phaseB]) {
        const cycles = phase[i] as number;
        tone += Math.sin(TWO_PI * cycles);
        c.overtones.forEach((gain, k) => {
          tone += gain * Math.sin(TWO_PI * cycles * (k + 2));
        });
      }
      dry[i] = (tone / 2) * (attackDecay(t, c.attackSec, c.decayTauSec) + 0.8 * attackDecay(t - c.firstSec, 0.012, c.decayTauSec));
    }
    const soft = filterBuffer(dry, 'lowpass', sr, c.lowpassHz);
    const out = Float32Array.from(soft);
    for (const tap of c.taps) mixInto(out, soft, tap.gain, Math.round(tap.delaySec * sr));
    return finishRender([out], sr, 'oneShot');
  },
};
