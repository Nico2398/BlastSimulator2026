// BlastSimulator2026 — Block power and gating
// The windowed building blocks of the measurements: mean-square power per short
// block, sliding windows over blocks, and BS.1770-style gating (an absolute floor,
// then a floor relative to what the gated blocks average).

import { LAB_STATS_CONFIG } from '../../core/config/audio/lab.js';
import { powerToDb } from './levels.js';

/**
 * Mean-square power of each block of `blockFrames` frames, summed over channels.
 * (Summing is the loudness convention; divide by the channel count for a per-channel mean.)
 */
export function blockPowers(channels: readonly ArrayLike<number>[], blockFrames: number): number[] {
  const frames = channels[0]?.length ?? 0;
  const powers: number[] = [];
  for (let start = 0; start < frames; start += blockFrames) {
    const end = Math.min(frames, start + blockFrames);
    let sum = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i++) {
        const v = channel[i] ?? 0;
        sum += Number.isFinite(v) ? v * v : 0;
      }
    }
    powers.push(sum / Math.max(1, end - start));
  }
  return powers;
}

/** Mean power of every run of `windowBlocks` consecutive blocks (a window per start block; a short signal gives one window). */
export function slidingMeans(powers: readonly number[], windowBlocks: number): number[] {
  if (powers.length === 0) return [];
  const size = Math.min(windowBlocks, powers.length);
  const means: number[] = [];
  let sum = 0;
  for (let i = 0; i < powers.length; i++) {
    sum += powers[i] ?? 0;
    if (i >= size) sum -= powers[i - size] ?? 0;
    if (i >= size - 1) means.push(sum / size);
  }
  return means;
}

/**
 * Mean of the windows that pass both gates: louder than `absoluteGateDb`, and
 * louder than `relativeGateDb` under the mean of the windows that passed the first.
 * Windows are powers; the gates compare in `offsetDb`-shifted decibels. Zero when nothing passes.
 */
export function gatedMean(windows: readonly number[], absoluteGateDb: number, relativeGateDb: number, offsetDb = 0): number {
  const aboveAbsolute = windows.filter(power => powerToDb(power) + offsetDb > absoluteGateDb);
  if (aboveAbsolute.length === 0) return 0;
  const mean = (list: readonly number[]): number => list.reduce((a, b) => a + b, 0) / list.length;
  const relativeFloorDb = powerToDb(mean(aboveAbsolute)) + offsetDb + relativeGateDb;
  const passing = aboveAbsolute.filter(power => powerToDb(power) + offsetDb > relativeFloorDb);
  return passing.length > 0 ? mean(passing) : 0;
}

/** Frames in one measurement block of a signal at `sampleRate`. */
export function blockFramesFor(sampleRate: number): number {
  return Math.max(1, Math.round(LAB_STATS_CONFIG.blockS * sampleRate));
}
