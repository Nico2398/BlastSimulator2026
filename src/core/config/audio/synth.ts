// BlastSimulator2026 — Synth tunables
// Pure data for the generative sound recipes: levels, durations, sample rates and the
// shape of every sound. Frequencies in Hz, times in seconds, levels in dBFS or linear
// gain as named. Loop beds express modulation as whole cycles per loop so every
// modulator wraps seamlessly.

export const SYNTH_LEVELS = {
  /** Gated RMS of every one-shot. */
  oneShotDb: -18,
  /** Gated RMS of every loop. */
  loopDb: -26,
  /** Sample-peak and true-peak ceiling. */
  peakCeilingDb: -1,
  /** Soft-limiter knee, as a fraction of the ceiling. */
  limiterKnee: 0.6,
  /** Frames quieter than this do not count towards the gated RMS. */
  gateDb: -50,
  gateFrameSec: 0.4,
  gateHopSec: 0.1,
  /** Edge fades applied to every one-shot. */
  fadeInSec: 0.002,
  fadeOutSec: 0.02,
  /** Samples between filter coefficient updates when a cutoff is modulated. */
  filterControlInterval: 16,
  /** How much of the loop end is pre-run so filters and echoes start settled. */
  loopWarmupSec: 0.5,
  /** Peak headroom under which the true-peak scan is skipped, dB. */
  truePeakScanMarginDb: 6,
  /** Samples between envelope evaluations in slow-moving recipes. */
  envelopeControlInterval: 8,
  /** Samples below this fraction of the sample peak are not interpolated for the true peak. */
  truePeakCandidateRatio: 0.35,
  /** Oversampling used to estimate the true peak. */
  truePeakOversample: 4,
} as const;

interface BlastSubVariant {
  readonly startHz: number;
  readonly pitchTauSec: number;
  readonly startPhase: number;
  readonly secondPhase: number;
  readonly rumbleSeedOffset: number;
}

export const BLAST_SUB_CONFIG = {
  sampleRate: 22050,
  durationSec: 2.2,
  endHz: 30,
  attackSec: 0.0035,
  decayTauSec: 0.7,
  secondHarmonicGain: 0.4,
  drive: 1.9,
  /** Lowpassed noise crack in the first moments. */
  transientGain: 0.55,
  transientLowpassHz: 900,
  transientTauSec: 0.022,
  /** Sub-100 Hz noise body that keeps the thump from being a bare sine. */
  rumbleGain: 0.35,
  rumbleLowpassHz: 70,
  rumbleTauSec: 0.55,
  variants: [
    { startHz: 82, pitchTauSec: 0.35, startPhase: 0.0, secondPhase: 0.15, rumbleSeedOffset: 0 },
    { startHz: 74, pitchTauSec: 0.27, startPhase: 0.21, secondPhase: 0.4, rumbleSeedOffset: 1 },
  ] satisfies readonly BlastSubVariant[],
} as const;

export const BLAST_TAIL_CONFIG = {
  sampleRate: 22050,
  durationSec: 4.5,
  startCutoffHz: 900,
  endCutoffHz: 120,
  cutoffTauSec: 1.1,
  filterQ: 0.8,
  swellSec: 0.22,
  decayTauSec: 1.4,
  /** Three slow rolling modulators; frequencies are drawn per channel from this range. */
  rollLfoHz: { min: 3, max: 9 },
  rollDepth: 0.3,
  debris: {
    /** Clicks per second at t = 0, falling with `tauSec`. */
    startRate: 55,
    tauSec: 1.5,
    gain: 0.32,
    freqHz: { min: 700, max: 3200 },
    ringTauSec: { min: 0.002, max: 0.006 },
  },
  variantCount: 2,
} as const;

export const BLAST_BEEP_CONFIG = {
  sampleRate: 44100,
  durationSec: 0.14,
  noteHz: 1050,
  detuneRatio: 1.0065,
  harmonics: 5,
  bodyGain: 0.3,
  attackSec: 0.003,
  holdSec: 0.115,
  releaseSec: 0.025,
  lowpassHz: 4000,
  clickGain: 0.12,
  clickTauSec: 0.0012,
} as const;

export const BLAST_CANCEL_CONFIG = {
  sampleRate: 44100,
  durationSec: 0.6,
  firstHz: 880,
  secondHz: 587,
  firstSec: 0.2,
  glideSec: 0.07,
  attackSec: 0.008,
  decayTauSec: 0.2,
  overtones: [0.28, 0.1],
  detuneRatio: 1.004,
  lowpassHz: 3000,
  /** Echo taps (delay seconds, gain) for the reverb-like tail. */
  taps: [
    { delaySec: 0.083, gain: 0.34 },
    { delaySec: 0.131, gain: 0.25 },
    { delaySec: 0.197, gain: 0.17 },
  ],
} as const;

export const SIREN_CONFIG = {
  sampleRate: 22050,
  durationSec: 3.2,
  lowHz: 520,
  highHz: 880,
  harmonics: 8,
  vibratoCycles: 17,
  vibratoDepth: 0.012,
  detuneRatio: 1.006,
  secondSawGain: 0.55,
  breathGain: 0.05,
  breathHz: 2200,
  lowpassHz: 3000,
  echoDelaySec: 0.045,
  echoGain: 0.3,
} as const;

interface ThunderVariant {
  readonly durationSec: number;
  readonly crackSec: number;
  readonly crackCentreHz: number;
  readonly crackBursts: number;
  readonly lobes: readonly { readonly atSec: number; readonly riseSec: number; readonly tauSec: number; readonly gain: number }[];
  readonly startCutoffHz: number;
  readonly cutoffTauSec: number;
}

export const THUNDER_CONFIG = {
  sampleRate: 22050,
  endCutoffHz: 70,
  filterQ: 0.9,
  crackQ: 0.8,
  crackGain: 1,
  rumbleGain: 1.1,
  overallTauSec: 2.6,
  variants: [
    {
      durationSec: 5.2, crackSec: 0.35, crackCentreHz: 2600, crackBursts: 5,
      lobes: [
        { atSec: 0.12, riseSec: 0.2, tauSec: 0.9, gain: 1 },
        { atSec: 1.1, riseSec: 0.3, tauSec: 0.8, gain: 0.75 },
        { atSec: 2.1, riseSec: 0.35, tauSec: 0.9, gain: 0.55 },
      ],
      startCutoffHz: 650, cutoffTauSec: 1.8,
    },
    {
      durationSec: 6.1, crackSec: 0.4, crackCentreHz: 1900, crackBursts: 7,
      lobes: [
        { atSec: 0.2, riseSec: 0.15, tauSec: 0.6, gain: 0.8 },
        { atSec: 0.8, riseSec: 0.25, tauSec: 1.2, gain: 1 },
        { atSec: 2.0, riseSec: 0.4, tauSec: 0.8, gain: 0.6 },
        { atSec: 3.1, riseSec: 0.4, tauSec: 1, gain: 0.45 },
      ],
      startCutoffHz: 520, cutoffTauSec: 2.2,
    },
    {
      durationSec: 6.9, crackSec: 0.3, crackCentreHz: 3300, crackBursts: 4,
      lobes: [
        { atSec: 0.1, riseSec: 0.1, tauSec: 0.5, gain: 0.7 },
        { atSec: 0.9, riseSec: 0.5, tauSec: 1.1, gain: 1 },
        { atSec: 2.4, riseSec: 0.5, tauSec: 1.2, gain: 0.7 },
        { atSec: 3.6, riseSec: 0.6, tauSec: 1.1, gain: 0.5 },
        { atSec: 4.5, riseSec: 0.6, tauSec: 0.9, gain: 0.3 },
      ],
      startCutoffHz: 760, cutoffTauSec: 2.6,
    },
  ] satisfies readonly ThunderVariant[],
} as const;

interface BandedNoise {
  readonly centreHz: number;
  readonly q: number;
  readonly gain: number;
  /** Gust cycles per loop for the amplitude and for the centre drift. */
  readonly gustCycles: number;
  readonly driftCycles: number;
  readonly driftDepth: number;
}

export const WIND_CONFIG = {
  sampleRate: 11025,
  durationSec: 16,
  lowpassHz: 2800,
  /** Fraction of the gust depth that is steady air. */
  floor: 0.4,
  bands: [
    { centreHz: 200, q: 1.1, gain: 1, gustCycles: 3, driftCycles: 2, driftDepth: 0.3 },
    { centreHz: 520, q: 1.4, gain: 0.8, gustCycles: 5, driftCycles: 3, driftDepth: 0.35 },
    { centreHz: 1100, q: 1.6, gain: 0.45, gustCycles: 7, driftCycles: 5, driftDepth: 0.3 },
  ] satisfies readonly BandedNoise[],
  /** Common slow swell shared by all bands, whole cycles per loop. */
  swellCycles: 1,
  swellDepth: 0.35,
} as const;

export interface RainConfig {
  readonly sampleRate: number;
  readonly durationSec: number;
  readonly hissHighpassHz: number;
  readonly hissLowpassHz: number;
  readonly hissGain: number;
  readonly patterHz: number;
  readonly patterGain: number;
  readonly roarHz: number;
  readonly roarGain: number;
  readonly dropletsPerSec: number;
  readonly dropletGain: number;
  readonly dropletHz: { readonly min: number; readonly max: number };
  readonly dropletTauSec: { readonly min: number; readonly max: number };
  readonly swellCycles: number;
  readonly swellDepth: number;
}

export const RAIN_LIGHT_CONFIG: RainConfig = {
  sampleRate: 24000,
  durationSec: 12,
  hissHighpassHz: 1000,
  hissLowpassHz: 9000,
  hissGain: 0.5,
  patterHz: 450,
  patterGain: 0.35,
  roarHz: 200,
  roarGain: 0,
  dropletsPerSec: 60,
  dropletGain: 3,
  dropletHz: { min: 3000, max: 7000 },
  dropletTauSec: { min: 0.0015, max: 0.004 },
  swellCycles: 3,
  swellDepth: 0.12,
};

export const RAIN_HEAVY_CONFIG: RainConfig = {
  sampleRate: 24000,
  durationSec: 12,
  hissHighpassHz: 900,
  hissLowpassHz: 10000,
  hissGain: 1,
  patterHz: 500,
  patterGain: 0.7,
  roarHz: 180,
  roarGain: 0.9,
  dropletsPerSec: 400,
  dropletGain: 1.1,
  dropletHz: { min: 3000, max: 7000 },
  dropletTauSec: { min: 0.001, max: 0.003 },
  swellCycles: 2,
  swellDepth: 0.1,
};

export const MACHINERY_CONFIG = {
  sampleRate: 22050,
  durationSec: 6,
  /** Whole firings per loop for each engine layer (23.0 Hz and about 23.7 Hz). */
  layers: [
    { firings: 138, gain: 1, driftCycles: 2, driftPhase: 0, pattern: [1, 0.78, 0.92, 0.7] },
    { firings: 142, gain: 0.7, driftCycles: 3, driftPhase: 0.3, pattern: [0.85, 1, 0.72, 0.9] },
  ],
  driftDepth: 0.03,
  timingJitter: 0.09,
  amplitudeJitter: 0.22,
  pulseHz: { min: 70, max: 90 },
  pulseTauSec: 0.013,
  thumpTauSec: 0.006,
  thumpGain: 0.7,
  lowpassHz: 420,
  clatterBand: { lowHz: 1500, highHz: 3000, gain: 0.16, gateTauSec: 0.009 },
} as const;

export const REVERB_CONFIG = {
  sampleRate: 32000,
  durationSec: 2.4,
  rt60Sec: 1.8,
  reflectionCount: 9,
  reflectionWindowSec: { min: 0.015, max: 0.12 },
  reflectionGain: 0.5,
  lateStartSec: 0.03,
  lateRiseSec: 0.05,
  startCutoffHz: 12000,
  endCutoffHz: 1500,
  cutoffTauSec: 0.9,
} as const;
