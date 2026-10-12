// BlastSimulator2026 — Loudness
// Integrated and short-term loudness of a mix in LUFS (ITU-R BS.1770 K-weighting,
// 400 ms gated windows, 3 s short-term windows), computed from planar PCM. Channels
// are summed with equal weight, as for stereo.

import { LAB_STATS_CONFIG } from '../../core/config/audio/lab.js';
import { blockFramesFor, blockPowers, gatedMean, slidingMeans } from './blockPower.js';
import { kWeight } from './kWeighting.js';
import { powerToDb } from './levels.js';

/** BS.1770 offset that makes a full-scale 997 Hz sine read the same in LUFS as the standard says. */
const LUFS_OFFSET_DB = -0.691;

interface LoudnessReport {
  /** Gated loudness of the whole mix (LUFS). */
  readonly integratedLufs: number;
  /** Loudest 3 s stretch (LUFS). */
  readonly shortTermMaxLufs: number;
}

export function measureLoudness(channels: readonly Float32Array[], sampleRate: number): LoudnessReport {
  const cfg = LAB_STATS_CONFIG;
  const weighted = channels.map(channel => kWeight(channel, sampleRate));
  const powers = blockPowers(weighted, blockFramesFor(sampleRate));
  const gatedPower = gatedMean(slidingMeans(powers, cfg.gateWindowBlocks), cfg.absoluteGateDb, cfg.relativeGateDb, LUFS_OFFSET_DB);
  const shortTerm = slidingMeans(powers, cfg.shortTermWindowBlocks);
  const loudest = shortTerm.reduce((most, power) => Math.max(most, power), 0);
  return {
    integratedLufs: gatedPower > 0 ? powerToDb(gatedPower) + LUFS_OFFSET_DB : cfg.floorDb,
    shortTermMaxLufs: loudest > 0 ? powerToDb(loudest) + LUFS_OFFSET_DB : cfg.floorDb,
  };
}
