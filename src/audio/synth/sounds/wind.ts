// BlastSimulator2026 — Wind bed
// Three bands of noise with slowly gusting amplitude and drifting centre frequencies, plus a
// shared slow swell. Every modulator has a whole number of cycles per loop and the filters are
// lap-settled, so the bed wraps without a seam. The two channels use independent noise and
// modulator phases.

import { WIND_CONFIG } from '../../../core/config/audio/synth.js';
import { controlTrack } from '../envelopes.js';
import { finishRender } from '../finish.js';
import { Biquad } from '../filters.js';
import { settleLoop } from '../loop.js';
import { whiteNoise } from '../noise.js';
import { loopSine } from '../oscillators.js';
import { rngFor } from '../seed.js';
import type { SynthRecipe } from '../types.js';

export const WIND_BED: SynthRecipe = {
  variants: 1,
  loop: true,
  render() {
    const c = WIND_CONFIG;
    const sr = c.sampleRate;
    const n = Math.round(c.durationSec * sr);
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < 2; ch++) {
      const rng = rngFor('wind_bed', 0, ch);
      const bands = c.bands.map((band) => {
        const gustPhase = rng.next();
        const gustPhase2 = rng.next();
        const driftPhase = rng.next();
        const equalise = band.gain * Math.sqrt(band.q / band.centreHz) * 30;
        return {
          band,
          noise: whiteNoise(rng, n),
          filter: new Biquad('bandpass', sr, band.centreHz, band.q),
          level: controlTrack(n, (i) => {
            const gust = 0.5 + 0.5 * (0.7 * loopSine(i, n, band.gustCycles, gustPhase) + 0.3 * loopSine(i, n, band.gustCycles * 2 + 1, gustPhase2));
            return equalise * (c.floor + (1 - c.floor) * gust * gust);
          }),
          centre: controlTrack(n, (i) => band.centreHz * (1 + band.driftDepth * loopSine(i, n, band.driftCycles, driftPhase))),
        };
      });
      const swellPhase = rng.next();
      const swell = controlTrack(n, (i) => 1 + c.swellDepth * loopSine(i, n, c.swellCycles, swellPhase));
      const lowpass = new Biquad('lowpass', sr, c.lowpassHz);
      const out = settleLoop(n, sr, (i) => {
        let sum = 0;
        for (const b of bands) sum += b.level(i) * b.filter.tick(b.noise[i] as number, b.centre(i), b.band.q);
        return lowpass.tick(sum * swell(i));
      });
      channels.push(out);
    }
    return finishRender(channels, sr, 'loop');
  },
};
