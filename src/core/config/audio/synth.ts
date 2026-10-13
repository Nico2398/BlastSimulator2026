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

interface BlastSnapVariant {
  /** Decay time constant of the broadband crack. */
  readonly crackTauSec: number;
  /** Start of the falling body sine. */
  readonly bodyStartHz: number;
  readonly bodyEndHz: number;
}

/** The shot's instantaneous onset: a broadband crack over a short punch, with a bright sizzle behind. */
export const BLAST_SNAP_CONFIG = {
  sampleRate: 44100,
  durationSec: 0.5,
  /** Fade-in, far shorter than the shared one: the crack must start at full strength, and 0.2 ms only keeps the first sample from being a step. */
  fadeInSec: 0.0002,
  crackHighpassHz: 800,
  /** Keeps the crack off the top octave, where noise makes the largest inter-sample overshoots. */
  crackLowpassHz: 14000,
  /** Noise punch between these edges. */
  bodyBandHz: { low: 150, high: 900 },
  bodyNoiseGain: 0.7,
  bodyNoiseTauSec: 0.045,
  /** Sine that falls from the variant's start to its end frequency. */
  bodySineGain: 0.45,
  bodySineTauSec: 0.05,
  bodyPitchTauSec: 0.05,
  /** Sizzle band and level against the crack (linear: 0.25 is -12 dB). */
  sizzleBandHz: { low: 3000, high: 9000 },
  sizzleGain: 0.25,
  sizzleTauSec: 0.12,
  /** Peak-normalised sum goes through tanh at this drive, for edge. */
  drive: 2.2,
  variants: [
    { crackTauSec: 0.014, bodyStartHz: 140, bodyEndHz: 70 },
    { crackTauSec: 0.02, bodyStartHz: 128, bodyEndHz: 64 },
  ] satisfies readonly BlastSnapVariant[],
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

/** One tone of a device sound: a band-limited square wave (piezo, buzzer, ringer), optionally trilling between two pitches. */
interface DeviceTone {
  readonly atSec: number;
  readonly durSec: number;
  readonly hz: number;
  /** Second pitch the tone alternates with, `trillHz` times a second (an electronic phone ringer). */
  readonly altHz?: number;
  readonly trillHz?: number;
  readonly gain: number;
}

/** A burst of radio hiss: the squelch opening when a call starts, or its tail when the sender lets go. */
interface DeviceHiss {
  readonly atSec: number;
  readonly durSec: number;
  readonly gain: number;
  /** Exponential decay time constant (s); omitted for a flat burst. */
  readonly tauSec?: number;
}

/** The small loudspeaker everything is heard through: band limits and how hard it is driven. */
interface DeviceSpeaker {
  readonly highpassHz: number;
  readonly lowpassHz: number;
  /** tanh drive; above 1 the speaker breaks up a little, as cheap ones do. */
  readonly drive: number;
}

export interface DeviceSoundConfig {
  readonly sampleRate: number;
  readonly durationSec: number;
  /** Odd harmonics of the square wave: few for a piezo beep, many for a rasping buzzer. */
  readonly harmonics: number;
  /** Edge ramp of every tone (s): short enough to read as a beep, long enough not to click. */
  readonly edgeSec: number;
  readonly tones: readonly DeviceTone[];
  readonly hiss: readonly DeviceHiss[];
  readonly speaker: DeviceSpeaker;
}

/** Radio band: a handheld's speaker passes roughly 400 Hz to 3 kHz, and breaks up a little when pushed. */
const RADIO_SPEAKER: DeviceSpeaker = { highpassHz: 420, lowpassHz: 3000, drive: 1.6 };
/** Squelch opening (a short flat burst) and its tail when the sender lets go. */
const SQUELCH_OPEN: DeviceHiss = { atSec: 0, durSec: 0.045, gain: 0.5 };
const squelchTail = (atSec: number): DeviceHiss => ({ atSec, durSec: 0.16, gain: 0.55, tauSec: 0.06 });

const radio = (tones: readonly DeviceTone[], tailAtSec: number): DeviceSoundConfig => ({
  sampleRate: 22050,
  durationSec: tailAtSec + 0.18,
  harmonics: 4,
  edgeSec: 0.004,
  tones,
  hiss: [SQUELCH_OPEN, squelchTail(tailAtSec)],
  speaker: RADIO_SPEAKER,
});

/** Electronic and radio sounds of the worksite. The real devices are tone and noise generators, so synthesis is the honest source. */
export const DEVICE_SOUNDS = {
  /** An order acknowledged over the site radio: squelch, a quick two-note "copy", the tail. */
  radio_order: radio([{ atSec: 0.06, durSec: 0.055, hz: 1180, gain: 0.5 }, { atSec: 0.125, durSec: 0.065, hz: 1560, gain: 0.5 }], 0.21),
  /** A report: one low beep. */
  radio_info: radio([{ atSec: 0.06, durSec: 0.09, hz: 990, gain: 0.45 }], 0.17),
  /** Good news: a rising pair. */
  radio_good: radio([{ atSec: 0.06, durSec: 0.07, hz: 1040, gain: 0.5 }, { atSec: 0.14, durSec: 0.1, hz: 1390, gain: 0.5 }], 0.26),
  /** A warning: two pairs of low beeps. */
  radio_warn: radio([
    { atSec: 0.06, durSec: 0.07, hz: 760, gain: 0.55 }, { atSec: 0.15, durSec: 0.07, hz: 760, gain: 0.55 },
    { atSec: 0.3, durSec: 0.07, hz: 760, gain: 0.55 }, { atSec: 0.39, durSec: 0.07, hz: 760, gain: 0.55 },
  ], 0.48),
  /** A job reported done: the squelch closing, nothing else. */
  radio_end: { ...radio([], 0.03), hiss: [{ atSec: 0, durSec: 0.03, gain: 0.35 }, squelchTail(0.03)] },
  /** The site cabin phone: two bursts of an electronic ringer trilling between two pitches. */
  phone_ring: {
    sampleRate: 22050,
    durationSec: 1.25,
    harmonics: 5,
    edgeSec: 0.006,
    tones: [
      { atSec: 0, durSec: 0.42, hz: 1020, altHz: 1290, trillHz: 18, gain: 0.45 },
      { atSec: 0.62, durSec: 0.42, hz: 1020, altHz: 1290, trillHz: 18, gain: 0.45 },
    ],
    hiss: [],
    speaker: { highpassHz: 500, lowpassHz: 4200, drive: 1.3 },
  },
  /** The site alarm buzzer: two short, low, rasping buzzes. */
  alarm_buzzer: {
    sampleRate: 22050,
    durationSec: 0.62,
    harmonics: 14,
    edgeSec: 0.005,
    tones: [{ atSec: 0, durSec: 0.2, hz: 185, gain: 0.6 }, { atSec: 0.29, durSec: 0.26, hz: 185, gain: 0.6 }],
    hiss: [],
    speaker: { highpassHz: 220, lowpassHz: 3400, drive: 2.4 },
  },
  /** A truck's backup alarm: three beeps of the classic ~1.15 kHz sounder, half a second apart. */
  reverse_beeper: {
    sampleRate: 22050,
    durationSec: 2.05,
    harmonics: 3,
    edgeSec: 0.012,
    tones: [
      { atSec: 0, durSec: 0.4, hz: 1150, gain: 0.5 },
      { atSec: 0.8, durSec: 0.4, hz: 1150, gain: 0.5 },
      { atSec: 1.6, durSec: 0.4, hz: 1150, gain: 0.5 },
    ],
    hiss: [],
    speaker: { highpassHz: 650, lowpassHz: 3600, drive: 1.4 },
  },
  /** A survey instrument logging a point: two short high piezo beeps. */
  instrument_beep: {
    sampleRate: 22050,
    durationSec: 0.22,
    harmonics: 2,
    edgeSec: 0.003,
    tones: [{ atSec: 0, durSec: 0.06, hz: 2700, gain: 0.45 }, { atSec: 0.11, durSec: 0.06, hz: 2700, gain: 0.45 }],
    hiss: [],
    speaker: { highpassHz: 900, lowpassHz: 6000, drive: 1.1 },
  },
} as const satisfies Record<string, DeviceSoundConfig>;

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
