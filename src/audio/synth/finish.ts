// BlastSimulator2026 — Final level shaping
// Takes a raw recipe render to the catalog's reference level: DC removed, edges faded
// (one-shots), gated RMS set to the target and the peak held under the ceiling by a soft
// limiter before a final true-peak guard.

import { SYNTH_LEVELS } from '../../core/config/audio/synth.js';
import { dbToGain } from '../engine/units.js';
import { fadeEdges } from './envelopes.js';
import { gainForGatedRms, gatedRmsDb, samplePeakDb, truePeakDb } from './loudness.js';
import type { RenderedAudio } from './types.js';

type SoundKind = 'oneShot' | 'loop';

const MAX_PASSES = 8;
const RMS_TOLERANCE_DB = 0.05;

function softCeiling(x: number, ceiling: number): number {
  const knee = ceiling * SYNTH_LEVELS.limiterKnee;
  const magnitude = Math.abs(x);
  if (magnitude <= knee) return x;
  const shaped = knee + (ceiling - knee) * Math.tanh((magnitude - knee) / (ceiling - knee));
  return x < 0 ? -shaped : shaped;
}

function removeDc(channel: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < channel.length; i++) sum += channel[i] as number;
  const mean = sum / channel.length;
  for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] as number) - mean;
}

function scaled(source: readonly Float32Array[], gain: number, ceiling: number): Float32Array[] {
  return source.map((channel) => {
    const out = new Float32Array(channel.length);
    for (let i = 0; i < channel.length; i++) out[i] = softCeiling((channel[i] as number) * gain, ceiling);
    return out;
  });
}

/**
 * Bring `raw` (left untouched) to the reference level for its kind. Loops keep their wrap and get no fades;
 * a one-shot whose onset must stay sharp passes a shorter `fadeInSec` than the shared default.
 */
export function finishRender(raw: readonly Float32Array[], sampleRate: number, kind: SoundKind, fadeInSec: number = SYNTH_LEVELS.fadeInSec): RenderedAudio {
  const work = raw.map((channel) => Float32Array.from(channel));
  for (const channel of work) removeDc(channel);
  if (kind === 'oneShot') {
    for (const channel of work) fadeEdges(channel, sampleRate, fadeInSec, SYNTH_LEVELS.fadeOutSec);
  }
  const targetDb = kind === 'oneShot' ? SYNTH_LEVELS.oneShotDb : SYNTH_LEVELS.loopDb;
  const ceiling = dbToGain(SYNTH_LEVELS.peakCeilingDb);
  let gain = gainForGatedRms(work, sampleRate, targetDb);
  let out = scaled(work, gain, ceiling);
  // Past the limiter knee the level is no longer linear in the gain, so converge by iteration.
  const limited = samplePeakDb(work) + 20 * Math.log10(gain) > SYNTH_LEVELS.peakCeilingDb + 20 * Math.log10(SYNTH_LEVELS.limiterKnee);
  for (let pass = 0; limited && pass < MAX_PASSES; pass++) {
    const errorDb = targetDb - gatedRmsDb(out, sampleRate);
    if (Math.abs(errorDb) <= RMS_TOLERANCE_DB) break;
    gain *= dbToGain(errorDb);
    out = scaled(work, gain, ceiling);
  }
  const peakDb = samplePeakDb(out);
  const overshootDb = (peakDb > SYNTH_LEVELS.peakCeilingDb - SYNTH_LEVELS.truePeakScanMarginDb ? truePeakDb(out) : peakDb) - SYNTH_LEVELS.peakCeilingDb;
  if (overshootDb > 0) {
    const trim = dbToGain(-overshootDb);
    for (const channel of out) for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] as number) * trim;
  }
  return { sampleRate, channels: out };
}
