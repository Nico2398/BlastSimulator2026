// BlastSimulator2026 — Lab verdict
// Turns a lab report into the list of reasons `npm run sounds:check` fails (a
// broken pipeline, an asset that went missing, or a mix that is silent, driven too hard
// into the safety clipper or poisoned with NaN) and the
// list of things worth a look that do not fail it.

import { LAB_CHECK_LIMITS } from '../../core/config/audio/lab.js';
import type { MixReport, SoundLabReport } from './labReport.js';
import { isMixScenarioName, type MixScenarioName } from './mixTypes.js';

/** The shared reverb impulse the engine renders on top of the sample and recipe counts. */
const EXPECTED_IMPULSES = 1;

/** How many assets a complete preload loads: every sample, every recipe and the reverb impulse. */
export function expectedAssetCount(report: SoundLabReport): number {
  return report.expected.samples + report.expected.recipes + EXPECTED_IMPULSES;
}

interface Verdict {
  /** Each one fails the check. */
  readonly problems: readonly string[];
  /** Worth a look; never fails the check. */
  readonly warnings: readonly string[];
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(3)} %`;
}

function mixProblems(mix: MixReport): string[] {
  const { stats } = mix;
  const problems: string[] = [];
  if (mix.failedAssets.length > 0) problems.push(`${mix.name}: offline engine could not load ${mix.failedAssets.join(', ')}`);
  if (stats.nonFiniteCount > 0) problems.push(`${mix.name}: ${stats.nonFiniteCount} NaN or infinite samples in the mix`);
  if (stats.peakDbfs > LAB_CHECK_LIMITS.maxPeakDbfs) {
    problems.push(`${mix.name}: peak ${stats.peakDbfs} dBFS is above ${LAB_CHECK_LIMITS.maxPeakDbfs} dBFS after the limiter`);
  }
  if (stats.clipperDrive > LAB_CHECK_LIMITS.maxClipperDrive) {
    problems.push(`${mix.name}: ${percent(stats.clipperDrive)} of samples are above the safety clipper's knee, above ${percent(LAB_CHECK_LIMITS.maxClipperDrive)} (the mix is driven too hard)`);
  }
  if (stats.gatedRmsDbfs < LAB_CHECK_LIMITS.minGatedRmsDbfs) {
    problems.push(`${mix.name}: gated RMS ${stats.gatedRmsDbfs} dBFS is below ${LAB_CHECK_LIMITS.minGatedRmsDbfs} dBFS (silent)`);
  }
  return problems;
}

function mixWarnings(mix: MixReport): string[] {
  const { stats } = mix;
  const warnings: string[] = [];
  if (stats.clipperDrive > LAB_CHECK_LIMITS.warnClipperDrive && stats.clipperDrive <= LAB_CHECK_LIMITS.maxClipperDrive) {
    warnings.push(`${mix.name}: ${percent(stats.clipperDrive)} of samples are above the safety clipper's knee (warning from ${percent(LAB_CHECK_LIMITS.warnClipperDrive)})`);
  }
  if (stats.clipCount > 0) warnings.push(`${mix.name}: ${stats.clipCount} samples at the 16-bit rail`);
  if (stats.dcOffset > LAB_CHECK_LIMITS.warnDcOffset) warnings.push(`${mix.name}: DC offset ${stats.dcOffset}`);
  if (stats.monoLossDb > LAB_CHECK_LIMITS.warnMonoLossDb) warnings.push(`${mix.name}: folds to mono ${stats.monoLossDb} dB quieter`);
  if (mix.dropped > 0) warnings.push(`${mix.name}: ${mix.dropped} of ${mix.requested} one-shots dropped by the player (cooldown, voice cap or budget)`);
  return warnings;
}

export function evaluateReport(report: SoundLabReport): Verdict {
  const problems: string[] = [...report.errors];
  if (report.failed.length > 0) problems.push(...report.failed.map(failure => `asset failed: ${failure}`));
  if (report.loaded.length === 0) problems.push('no asset loaded at all');
  const expectedAssets = expectedAssetCount(report);
  if (report.loaded.length > 0 && report.loaded.length < expectedAssets) {
    problems.push(`only ${report.loaded.length} of ${expectedAssets} assets loaded (an asset neither loaded nor reported as failed)`);
  }
  if (!report.ready) problems.push('the live engine never became ready (first loading tier incomplete)');
  if (report.contextState !== 'running') problems.push(`live AudioContext is "${report.contextState}", not "running"`);
  if (report.contextState === 'running' && !report.contextClockAdvanced) problems.push('live AudioContext is running but its clock never advanced');
  if (!report.livePlayOk) problems.push('a one-shot played on the live engine returned no voice');
  for (const failure of report.mixFailures) problems.push(`${failure.name}: render failed: ${failure.error}`);
  if (report.mixes.length === 0 && report.mixFailures.length === 0) problems.push('no mix was rendered');
  for (const mix of report.mixes) problems.push(...mixProblems(mix));
  return { problems, warnings: report.mixes.flatMap(mixWarnings) };
}

/**
 * The mixes of a report that may be written to disk. The report crosses a page boundary as plain JSON, so a mix
 * name is untrusted text that becomes a file name: only a known scenario name, and one that was asked for, passes.
 */
export function savableMixes(report: SoundLabReport, requested: readonly MixScenarioName[]): MixReport[] {
  return report.mixes.filter(mix => isMixScenarioName(mix.name) && requested.includes(mix.name));
}
