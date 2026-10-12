// BlastSimulator2026 — PCM statistics
// What the check measures of a rendered mix instead of listening to it: peak and
// clipping, DC offset, RMS (plain and gated so silent stretches do not drag it
// down), crest factor, loudness, a coarse per-second envelope and how much the
// stereo image loses when folded to mono. Every figure is a finite number.

import { MASTER_LIMITER_CONFIG } from '../../core/config/audio/engine.js';
import { LAB_STATS_CONFIG } from '../../core/config/audio/lab.js';
import { blockFramesFor, blockPowers, gatedMean, slidingMeans } from './blockPower.js';
import { downmixToMono } from './downmix.js';
import { amplitudeToDb, powerToDb, roundDb } from './levels.js';
import { measureLoudness } from './loudness.js';

export interface PcmStats {
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationS: number;
  /** Samples that are NaN or infinite (they are treated as silence in every other figure). */
  readonly nonFiniteCount: number;
  readonly peakDbfs: number;
  /** Samples at the rail of a 16-bit file. */
  readonly clipCount: number;
  /**
   * Fraction (0 to 1) of all samples whose magnitude is above the safety clipper's knee. The clipper is
   * monotonic, so a sample leaves it above the knee exactly when it entered above it: this measures how hard
   * the mix drives a clipper that keeps the final peak under its ceiling whatever happens (the peak and the
   * 16-bit rail count cannot see the drive).
   */
  readonly clipperDrive: number;
  /** Largest per-channel mean, as a fraction of full scale. */
  readonly dcOffset: number;
  /** RMS of the whole signal (dBFS, per-channel mean power). */
  readonly rmsDbfs: number;
  /** RMS of the windows that pass the gates (dBFS). */
  readonly gatedRmsDbfs: number;
  /** Peak minus gated RMS (dB). */
  readonly crestFactorDb: number;
  readonly integratedLufs: number;
  readonly shortTermMaxLufs: number;
  /** RMS lost when the channels are averaged into one (dB, 0 or more; large means out-of-phase content). */
  readonly monoLossDb: number;
  /** RMS of each second of the mix (dBFS). */
  readonly envelopeDbfs: readonly number[];
}

interface Scan {
  peak: number;
  clipCount: number;
  /** Samples above the clipper knee. */
  hotCount: number;
  nonFinite: number;
  dcOffset: number;
}

function scanChannels(channels: readonly Float32Array[]): Scan {
  const scan: Scan = { peak: 0, clipCount: 0, hotCount: 0, nonFinite: 0, dcOffset: 0 };
  for (const channel of channels) {
    let sum = 0;
    for (let i = 0; i < channel.length; i++) {
      const v = channel[i] ?? 0;
      if (!Number.isFinite(v)) {
        scan.nonFinite++;
        continue;
      }
      const magnitude = Math.abs(v);
      sum += v;
      if (magnitude > scan.peak) scan.peak = magnitude;
      if (magnitude >= LAB_STATS_CONFIG.clipThreshold) scan.clipCount++;
      if (magnitude > MASTER_LIMITER_CONFIG.clipKnee) scan.hotCount++;
    }
    scan.dcOffset = Math.max(scan.dcOffset, Math.abs(sum / Math.max(1, channel.length)));
  }
  return scan;
}

/** Mean power per channel across the signal (what "RMS" of a stereo file means). */
function meanPower(channels: readonly Float32Array[]): number {
  const frames = channels[0]?.length ?? 0;
  if (frames === 0) return 0;
  const total = blockPowers(channels, frames)[0] ?? 0;
  return total / channels.length;
}

function envelope(channels: readonly Float32Array[], sampleRate: number): number[] {
  const cellFrames = Math.max(1, Math.round(LAB_STATS_CONFIG.envelopeCellS * sampleRate));
  return blockPowers(channels, cellFrames).map(power => roundDb(powerToDb(power / channels.length)));
}

export function measurePcm(channels: readonly Float32Array[], sampleRate: number): PcmStats {
  const cfg = LAB_STATS_CONFIG;
  const frames = channels[0]?.length ?? 0;
  const scan = scanChannels(channels);
  const totalSamples = Math.max(1, frames * channels.length);
  const rmsDb = powerToDb(meanPower(channels));
  const perChannelPowers = blockPowers(channels, blockFramesFor(sampleRate)).map(power => power / Math.max(1, channels.length));
  const gatedPower = gatedMean(slidingMeans(perChannelPowers, cfg.gateWindowBlocks), cfg.absoluteGateDb, cfg.relativeGateDb);
  const gatedDb = gatedPower > 0 ? powerToDb(gatedPower) : cfg.floorDb;
  const peakDb = amplitudeToDb(scan.peak);
  const loudness = measureLoudness(channels, sampleRate);
  const monoDb = powerToDb(meanPower([downmixToMono(channels)]));
  return {
    sampleRate,
    channels: channels.length,
    durationS: Math.round((frames / sampleRate) * 1000) / 1000,
    nonFiniteCount: scan.nonFinite,
    peakDbfs: roundDb(peakDb),
    clipCount: scan.clipCount,
    clipperDrive: Math.round((scan.hotCount / totalSamples) * 1e6) / 1e6,
    dcOffset: Math.round(scan.dcOffset * 1e6) / 1e6,
    rmsDbfs: roundDb(rmsDb),
    gatedRmsDbfs: roundDb(gatedDb),
    crestFactorDb: roundDb(Math.max(0, peakDb - gatedDb)),
    integratedLufs: roundDb(loudness.integratedLufs),
    shortTermMaxLufs: roundDb(loudness.shortTermMaxLufs),
    monoLossDb: roundDb(Math.max(0, rmsDb - monoDb)),
    envelopeDbfs: envelope(channels, sampleRate),
  };
}
