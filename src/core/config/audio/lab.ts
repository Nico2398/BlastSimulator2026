// BlastSimulator2026 — Sound lab tuning (pure data)
// The numbers of the dev-only sound lab page and of `npm run sounds:check`: how
// the offline mixes are rendered, how the measurements are gated, and the limits
// a mix has to stay inside. Nothing here reaches the shipped game.

/** How a scenario is rendered offline. */
export const LAB_RENDER_CONFIG = {
  /** Stereo output rate of every offline mix. */
  sampleRate: 48000,
  channels: 2,
  /** Web Audio renders in blocks of this many frames; pause points snap to them. */
  renderQuantumFrames: 128,
  /**
   * The offline render pauses at least this often (s) and schedules the sounds of the next stretch.
   * Smaller than the in-game blast lookahead, so voice caps and cooldowns see no more
   * pending voices than they do in play.
   */
  scheduleStepS: 0.1,
  /** Seed of the random source that plans scenarios and varies the engine (fixed: mixes are reproducible). */
  seed: 20260301,
  /** Silence added after the last event of a scenario so reverb and blast tails ring out (s). */
  tailS: 8,
  /** Where the listener sits and how far its camera is (m): the spatial reference distance follows the camera. */
  listener: { x: 0, z: 0, rightX: 1, rightZ: 0, viewDistance: 40 },
} as const;

/** Measurement settings of the PCM statistics. */
export const LAB_STATS_CONFIG = {
  /** Floor of every dB figure, so a silent signal is -120 and not -Infinity (JSON cannot carry infinities). */
  floorDb: -120,
  /** A sample at or beyond this magnitude counts as clipped: it would sit on the rail of a 16-bit file. */
  clipThreshold: 1 - 1 / 32768,
  /** Length of the blocks all windowed measurements are built from (s). */
  blockS: 0.1,
  /** A gating window and a momentary-loudness window span this many blocks (400 ms). */
  gateWindowBlocks: 4,
  /** The short-term loudness window spans this many blocks (3 s). */
  shortTermWindowBlocks: 30,
  /** Windows quieter than this are ignored by the gated RMS (dBFS) and the gated loudness (LUFS). */
  absoluteGateDb: -70,
  /** Windows more than this far under the loudest-ish average are ignored as well (dB). */
  relativeGateDb: -10,
  /** Length of one cell of the per-second envelope (s). */
  envelopeCellS: 1,
} as const;

/** What `sounds:check` accepts of a rendered mix. */
export const LAB_CHECK_LIMITS = {
  /** After the master limiter nothing should come closer to full scale than this (dBFS). */
  maxPeakDbfs: -0.1,
  /**
   * The safety clipper pins the final peak under its ceiling (-0.27 dBFS), so the peak limit above can only
   * fire on a broken graph. How hard the mix drives the clipper is the real over-boost guard: the fraction of
   * samples above MASTER_LIMITER_CONFIG.clipKnee. Measured on the three lab mixes (2026-10, maxBoostDb 3):
   * ui-tour 0.002 %, blast 0.085 %, busy-mine 0.0002 %. Re-scaling the measured blast gives about 0.21 % at
   * +1 dB, 0.36 % at +2 dB and 0.55 % at +3 dB, so the warning sits at about +1 dB of the loudest mix and the
   * failure at over 10 times today's blast, well beyond any intended gain change.
   */
  warnClipperDrive: 0.0025,
  maxClipperDrive: 0.01,
  /** A mix whose gated RMS is below this is silent (dBFS). */
  minGatedRmsDbfs: -60,
  /** Warn (never fail) beyond these. */
  warnDcOffset: 0.01,
  warnMonoLossDb: 6,
} as const;

/** The live panel's own settings. */
export const LAB_PANEL_CONFIG = {
  /** Status line refresh (ms). */
  statusIntervalMs: 250,
  /** Live scenario scheduler step (ms): sounds are booked at most this far ahead. */
  liveStepMs: 50,
  /** Length of the "Busy mine" bed (s): the first stretch of the busy-mine scenario. */
  busyMineLiveS: 20,
  distance: { minM: 0, maxM: 200, defaultM: 15, stepM: 1 },
  viewDistance: { minM: 10, maxM: 150, defaultM: 40, stepM: 1 },
  loopLevel: { default: 0.6, rampS: 0.5 },
  /** Autotest: how long to wait for the live context to start running (ms) and how often to look. */
  contextWaitMs: 4000,
  contextPollMs: 100,
} as const;

/** The synthetic blast of the lab scenarios: roughly a 24-hole round with a few hundred fragments. */
export const LAB_BLAST_SHAPE = {
  /** Metres from the listener (x right, z away). */
  origin: { x: 30, z: -20 },
  holeCount: 24,
  chargeKg: 300,
  flightCount: 240,
  scatterRadiusM: 28,
  maxLaunchDelayS: 0.6,
  minFlightS: 1.1,
  maxFlightS: 4.6,
  minImpactSpeed: 4,
  maxImpactSpeed: 62,
  destroyedBuilding: { x: 48, z: -8 },
  secondary: { x: 12, z: -34, explosivesKg: 80 },
} as const;

/** The arming phase of the blast scenario: siren, beeps that speed up, then the shot. */
export const LAB_BLAST_SCENARIO = {
  /** Heavy rain is on, so the ducked beds are audible (AMBIENCE_CONFIG.weather.heavy_rain: storm wind and heavy rain). */
  rainLevel: 0.75,
  windLevel: 0.3,
  bedRampS: 1,
  sirenOnS: 1,
  firstBeepS: 2,
  lastBeepS: 12,
  /** The siren stops and the air holds its breath this long before the shot. */
  sirenOffS: 12.4,
  blastS: 13.2,
} as const;

/** The busy-mine scenario: a working mine for a minute, with a storm over the last stretch. */
export const LAB_BUSY_MINE = {
  durationS: 60,
  stormFromS: 45,
  stormRampS: 3,
  /** The fair-weather breeze, then the storm wind and rain (AMBIENCE_CONFIG.weather: sunny, storm). */
  windLevel: 0.1,
  stormWindLevel: 0.75,
  stormRainLevel: 0.9,
  /** A passing shower before the storm. */
  lightRain: { fromS: 26, toS: 40, level: 0.6, rampS: 3 },
  /** Two machines working next to the listener: the diesel bed at its ceiling (WORK_CONFIG.machinery.maxLevel). */
  machineryLevel: 0.45,
  /** Crews are this far from the listener (m). */
  nearM: { min: 8, max: 40 },
  haulGapS: { min: 1.6, max: 3 },
  workGapS: { min: 2.2, max: 5 },
  /** Far-away life sounds (m) and level (dB). */
  farM: { min: 90, max: 150 },
  farGainDb: -8,
  thunderAtS: [47.2, 51, 55.4],
  thunderGainDb: { min: -5, max: 0 },
  rumbleAtS: 58,
  rumbleGainDb: -10,
} as const;
