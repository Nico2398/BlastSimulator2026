// BlastSimulator2026 — Audio engine tuning (pure data)
// Every number the Web Audio engine uses: where sample files are served from,
// how the master limiter is set, how many sounds may overlap, how distance
// shapes a positional sound, how long fades and ducks take. The engine logic
// stays free of magic numbers; change the feel here.

/** Where the decoded one-shots come from. */
export const SAMPLE_BANK_CONFIG = {
  /** URL prefix of the sample files (served from public/audio/sfx/). */
  assetBase: '/audio/sfx/',
  fileExtension: '.mp3',
  /** Files fetched and decoded at once. */
  decodeConcurrency: 4,
} as const;

/** Rendering of the generative sounds at startup. */
export const SYNTH_RENDER_CONFIG = {
  /** A render task yields to the event loop once it has run this long (ms), so the page keeps painting. */
  sliceBudgetMs: 16,
} as const;

/**
 * Master-bus limiter: a DynamicsCompressorNode, then a safety soft clipper.
 * Web Audio compressors are not brickwall (the attack lets a transient through),
 * so a WaveShaperNode after it bends whatever still gets past toward a ceiling.
 * The clipper is a safety net, not part of the sound: the mix is gain-staged to
 * stay below its knee.
 */
export const MASTER_LIMITER_CONFIG = {
  thresholdDb: -3,
  kneeDb: 0,
  ratio: 20,
  attackS: 0.002,
  releaseS: 0.15,
  /** Linear level below which the clipper is the identity. */
  clipKnee: 0.8,
  /** Linear level the clipper's shoulder approaches (about -0.27 dBFS); the node's input clamp holds the output slightly below it. */
  clipCeiling: 0.97,
  /** Samples of the transfer curve over [-1, 1]; odd so 0 maps to 0 exactly. */
  clipCurveSize: 4097,
  /** Oversampling of the clipper, so the saturation does not alias. */
  clipOversample: '4x',
} as const;

/** Bus graph behaviour. */
export const MIXER_CONFIG = {
  /** Time constant of a volume slider move (s): long enough to avoid zipper noise, short enough to feel direct. */
  volumeSmoothS: 0.03,
  /** Level of the shared reverb's return before it joins the master bus. */
  reverbReturnGain: 0.8,
} as const;

/** Bus ducking (blasts pull the ambience down). */
export const DUCK_CONFIG = {
  /** Linear ramp down to the ducked level (s). */
  attackS: 0.03,
  /** A release of `releaseS` is an exponential approach of this many time constants. */
  releaseTimeConstants: 4,
  /** Ducks never go deeper than this (dB), whatever a caller asks for. */
  maxDepthDb: -48,
} as const;

/** Voice allocation and fades. */
export const VOICE_CONFIG = {
  /** Sounds playing at once across all buses before the priority rules start dropping or stealing. */
  globalVoiceCap: 32,
  /** Fade of `stop()` when the caller gives none (s): short enough to feel instant, long enough not to click. */
  defaultStopFadeS: 0.01,
  /** Fade a voice gets when another one steals its slot (s). */
  stealFadeS: 0.02,
  /** Ramp of a loop level change when the caller gives none (s). */
  defaultLoopRampS: 0.25,
  /** Smallest loop fade-out (s) so a level of 0 never cuts abruptly. */
  minLoopRampS: 0.01,
  /** Cooldown entries beyond this count are swept when expired. */
  cooldownSweepThreshold: 64,
  /** Pitch is clamped to this many cents either way so jitter plus caller shift cannot leave the audible band. */
  maxPitchCents: 2400,
  /** Extra seconds past a fade before its source is stopped, so the ramp always completes. */
  stopMarginS: 0.005,
} as const;

/** Which samples must be decoded before the first click or boom (tier 1). */
export const PRELOAD_CONFIG = {
  /** Samples used by a catalog entry of at least this priority are tier 1. */
  essentialPriority: 3,
} as const;

/** How distance, direction and zoom shape a positional sound. */
export const SPATIAL_CONFIG = {
  /** Reference distance (m, inside it a source is at full level) per metre of camera distance. */
  referencePerViewMetre: 0.6,
  minReferenceM: 10,
  maxReferenceM: 90,
  /** Inverse-distance rolloff factor beyond the reference distance. */
  rolloff: 1,
  /** Level never falls below this (before the cull fade) so a far blast still registers. */
  floorGain: 0.06,
  /** Sources beyond this multiple of the reference distance are culled. */
  cullDistanceFactor: 6,
  /** The last fraction of the cull distance fades to silence, so crossing it never pops. */
  cullFadeFraction: 0.25,
  /** A source quieter than this is not played at all. */
  audibleGain: 0.015,
  /** Camera distance (m) at which the zoom trim is 1; closer is also 1. */
  zoomTrimNearViewM: 15,
  /** Exponent of the loss when the camera pulls back (zoomed out = wider but quieter). */
  zoomTrimExponent: 0.35,
  zoomTrimMin: 0.4,
  /** Largest stereo offset (-1..1 is the full range of a StereoPannerNode). */
  maxPan: 0.85,
  /** Within this distance (m) the pan eases toward centre, so passing close by never snaps left-right. */
  panEaseDistanceM: 4,
  /** Air absorption: cutoff = lowpassMaxHz * airDistanceM / (airDistanceM + d), floored at lowpassMinHz. */
  lowpassMaxHz: 20000,
  lowpassMinHz: 1800,
  airDistanceM: 60,
  /** Resonance of the per-voice lowpass (flat). */
  lowpassQ: 0.707,
} as const;
