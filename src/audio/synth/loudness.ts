// BlastSimulator2026 — Level measurement

import { SYNTH_LEVELS } from '../../core/config/audio/synth.js';

const FLOOR_DB = -200;
const GAIN_SOLVER_PASSES = 12;
const GAIN_SOLVER_TOLERANCE_DB = 0.001;

function toDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : FLOOR_DB;
}

interface FrameEnergies {
  /** Mean square of each analysis frame. */
  readonly frames: readonly number[];
  /** Mean square of the whole signal. */
  readonly whole: number;
}

function measureFrames(channels: readonly Float32Array[], sampleRate: number): FrameEnergies {
  const length = channels[0]?.length ?? 0;
  if (length === 0) return { frames: [], whole: 0 };
  const cumulative = new Float64Array(length + 1);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const channel of channels) sum += (channel[i] as number) ** 2;
    cumulative[i + 1] = (cumulative[i] as number) + sum / channels.length;
  }
  const meanSquare = (from: number, to: number): number => ((cumulative[to] as number) - (cumulative[from] as number)) / (to - from);
  const frame = Math.min(length, Math.round(SYNTH_LEVELS.gateFrameSec * sampleRate));
  const hop = Math.max(1, Math.round(SYNTH_LEVELS.gateHopSec * sampleRate));
  const frames: number[] = [];
  for (let start = 0; start + frame <= length; start += hop) frames.push(meanSquare(start, start + frame));
  frames.push(meanSquare(length - frame, length));
  return { frames, whole: meanSquare(0, length) };
}

/** Gated RMS in dB of the measured frames after scaling the signal by `gain`. */
function gatedDb(measured: FrameEnergies, gain: number): number {
  const gate = 10 ** (SYNTH_LEVELS.gateDb / 10);
  const scale = gain * gain;
  let total = 0;
  let kept = 0;
  for (const energy of measured.frames) {
    if (energy * scale > gate) {
      total += energy * scale;
      kept++;
    }
  }
  const mean = kept > 0 ? total / kept : measured.whole * scale;
  return mean > 0 ? 10 * Math.log10(mean) : FLOOR_DB;
}

/**
 * RMS over all channels, counting only 400 ms frames (100 ms hop, plus one frame aligned to the
 * end) louder than the gate. Falls back to the whole signal when every frame is gated out.
 */
export function gatedRmsDb(channels: readonly Float32Array[], sampleRate: number): number {
  return gatedDb(measureFrames(channels, sampleRate), 1);
}

/**
 * Linear gain that brings the gated RMS to `targetDb`. The gate is absolute, so the frames that
 * count depend on the gain itself; this iterates to the fixed point.
 */
export function gainForGatedRms(channels: readonly Float32Array[], sampleRate: number, targetDb: number): number {
  const measured = measureFrames(channels, sampleRate);
  let gain = 1;
  for (let pass = 0; pass < GAIN_SOLVER_PASSES; pass++) {
    const errorDb = targetDb - gatedDb(measured, gain);
    if (Math.abs(errorDb) < GAIN_SOLVER_TOLERANCE_DB) break;
    gain *= 10 ** (errorDb / 20);
  }
  return gain;
}

/** Largest absolute sample over all channels, in dBFS. */
export function samplePeakDb(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i] as number));
  }
  return toDb(peak);
}

const SINC_HALF_TAPS = 6;

/** Windowed-sinc kernels for the fractional positions between samples, one row per oversampling phase. */
function interpolationKernels(): number[][] {
  const kernels: number[][] = [];
  for (let phase = 1; phase < SYNTH_LEVELS.truePeakOversample; phase++) {
    const fraction = phase / SYNTH_LEVELS.truePeakOversample;
    const kernel: number[] = [];
    for (let tap = 1 - SINC_HALF_TAPS; tap <= SINC_HALF_TAPS; tap++) {
      const x = tap - fraction;
      const window = 0.5 + 0.5 * Math.cos((Math.PI * x) / SINC_HALF_TAPS);
      kernel.push((Math.sin(Math.PI * x) / (Math.PI * x)) * window);
    }
    kernels.push(kernel);
  }
  return kernels;
}

/**
 * Inter-sample peak estimate from a windowed-sinc interpolation at `truePeakOversample` times the
 * rate. Only the neighbourhood of samples within `truePeakCandidateRatio` of the sample peak is
 * interpolated; an inter-sample maximum far above both of its neighbours does not occur in
 * programme material.
 */
export function truePeakDb(channels: readonly Float32Array[]): number {
  const kernels = interpolationKernels();
  let samplePeak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) samplePeak = Math.max(samplePeak, Math.abs(channel[i] as number));
  }
  const candidate = samplePeak * SYNTH_LEVELS.truePeakCandidateRatio;
  let peak = samplePeak;
  for (const channel of channels) {
    const last = channel.length - 1;
    for (let i = 0; i < last; i++) {
      if (Math.max(Math.abs(channel[i] as number), Math.abs(channel[i + 1] as number)) < candidate) continue;
      for (const kernel of kernels) {
        let value = 0;
        for (let k = 0; k < kernel.length; k++) {
          value += (kernel[k] as number) * (channel[Math.min(last, Math.max(0, i + k + 1 - SINC_HALF_TAPS))] as number);
        }
        peak = Math.max(peak, Math.abs(value));
      }
    }
  }
  return toDb(peak);
}

/** Mean sample value of the first channel (DC offset). */
export function dcOffset(channels: readonly Float32Array[]): number {
  const first = channels[0];
  if (first === undefined || first.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < first.length; i++) sum += first[i] as number;
  return sum / first.length;
}
