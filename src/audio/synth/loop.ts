// BlastSimulator2026 — Seamless loop construction
// A loop is built as a periodic steady state, not a clip with a crossfade: the generator is
// first run over the last stretch of the loop and then over the whole loop, and only the
// second pass is kept. All modulators and noise are periodic in the loop length, so by the
// time sample 0 is produced every filter and echo holds exactly the state the end of the loop
// hands back to the start, and the wrap is as smooth as any other pair of adjacent samples.

import { SYNTH_LEVELS } from '../../core/config/audio/synth.js';

/** Render `step(i)` for i in [0, length) with its state pre-settled; `step` may keep state between calls. */
export function settleLoop(length: number, sampleRate: number, step: (index: number) => number): Float32Array {
  const warmup = Math.min(length, Math.round(SYNTH_LEVELS.loopWarmupSec * sampleRate));
  for (let i = length - warmup; i < length; i++) step(i);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = step(i);
  return out;
}
