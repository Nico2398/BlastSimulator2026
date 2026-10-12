// BlastSimulator2026 — Game audio director tuning (pure data)
// Every number the world/gameplay audio director uses: how bursts are coalesced,
// how often work and life sounds fire, how a blast timeline is laid out, how
// the weather beds are mixed. Sound ids and logic live in src/audio/director;
// change the feel here. All times are REAL seconds: the simulation auto-ticks
// 1/2/4/8x as one synchronous command per real second, so nothing in here may
// scale with game speed.

import type { WeatherState } from '../../weather/WeatherCycle.js';

/** Shared rules of the director's feeds. */
export const DIRECTOR_CONFIG = {
  /** A frame step longer than this (s) is clamped: a frozen tab must not fire a backlog of timers. */
  maxFrameStepS: 0.25,
  /** Ticks one state diff may span (an 8x batch is 8). A larger jump is a load or a console skip and plays nothing. */
  maxCoalescedTicks: 8,
  /** Cooldown entries beyond this count are swept when expired. */
  cooldownSweepThreshold: 256,
  /** Entities remembered per burst between two flushes; the rest of a bigger burst is ignored. */
  maxPendingEntities: 512,
  /** A world cue from an event or a work site is only worth a voice within this multiple of the listener's reference distance (the engine culls at a larger one). */
  nearRangeFactor: 2.5,
} as const;

/** Per-entity cues fed by core events. One flush plays at most `maxPerFlush`, nearest to the listener first. */
export const EVENT_CUES = {
  haulLoad: { maxPerFlush: 2, entityCooldownS: 1.5 },
  haulDump: { maxPerFlush: 2, entityCooldownS: 1.5 },
  boulder: { maxPerFlush: 1, entityCooldownS: 2 },
  vehicleStart: { maxPerFlush: 1, entityCooldownS: 5 },
  horn: { maxPerFlush: 1, entityCooldownS: 30 },
  collapse: { maxPerFlush: 1, entityCooldownS: 10 },
} as const;

/** Global budget shared by every hauling cue, so a big blast's hundreds of trips stay a texture at any speed. */
export const HAUL_BUDGET_CONFIG = {
  capacity: 3,
  refillPerS: 1.5,
} as const;

/** Cues that are not tied to an entity: one per burst, with a cooldown. */
export const FLAG_CUES = {
  levelUp: { cooldownS: 2.5 },
  shiftBell: { cooldownS: 8 },
  unlock: { cooldownS: 1 },
  /** Off-screen collapse falls back to a muted alert, since nobody can see it. */
  offscreenCollapse: { cooldownS: 10, gainDb: -3 },
} as const;

/** End-of-level stings. */
export const LEVEL_END_CONFIG = {
  /** Ambience steps aside for the sting. */
  duck: { amountDb: -8, holdS: 3, releaseS: 2 },
} as const;

/** What the per-tick state diff plays. */
export const DIFF_CONFIG = {
  cooldownsS: {
    built: 0.5,
    demolished: 0.5,
    vehicleStart: 0.8,
    vehicleScrap: 0.5,
    orderDone: 0.8,
    drillDone: 0.5,
    chargeLoaded: 0.5,
    surveyDone: 1,
    collapse: 2,
    notifyBad: 3,
    eventAlert: 1,
  },
  /** Action types that finish without a world cue of their own, so they get the quiet `order_done` chime. */
  genericDoneActions: ['dig_ramp_segment', 'level_ground', 'general_work'],
  /** Action types that are bookkeeping noise (a blast queues hundreds of hauls): never tracked. */
  noiseActions: ['rest', 'haul_debris', 'fragment_debris', 'repair_vehicle'],
  /** Income categories worth a coin sound; upkeep, refunds and smuggling stay silent. */
  incomeCategories: ['sales', 'contracts', 'bonus'],
  income: {
    /** Income in one diff below this plays nothing. */
    minAmount: 100,
    /** From here `coins_big`, from `tillAmount` the cash register. */
    bigAmount: 2500,
    tillAmount: 10000,
    smallCooldownS: 3,
    bigCooldownS: 6,
  },
  /** A pending event steps the ambience aside and rings a category flourish a beat after the alert. */
  eventAlert: {
    flourishDelayS: 0.4,
    duck: { amountDb: -4, holdS: 1.2, releaseS: 1.5 },
  },
} as const;

/** Work-site bursts and the machinery bed. */
export const WORK_CONFIG = {
  /** Work sites that make sound at once: the nearest ones only. */
  maxSites: 2,
  /** How often the nearest sites are re-picked (s). */
  selectionIntervalS: 0.5,
  /** Gap between two bursts of one site (s), random in this range. */
  burstMinS: 1.8,
  burstMaxS: 4,
  /** A freshly picked site starts within this many seconds, so sites never sync up. */
  firstBurstMaxS: 1.2,
  machinery: {
    /** Working or driving units near the listener for the bed to reach full level. */
    unitsForFull: 6,
    /** Highest bed level: it is a texture under everything else. */
    maxLevel: 0.7,
    /** Smoothing time constant of the activity measure (s). */
    smoothTauS: 2.5,
    rampS: 0.8,
    /** Level changes smaller than this are not sent to the player. */
    epsilon: 0.03,
    /** Units count within this multiple of the reference distance. */
    rangeFactor: 3.5,
  },
} as const;

/** The blast timeline. */
export const BLAST_AUDIO_CONFIG = {
  /** A blast of this many holes (or kilograms of charge) is "full scale": +maxBoostDb. */
  fullScaleHoles: 60,
  fullScaleChargeKg: 600,
  /** Loudness added on top of the catalog trim at full scale; never above. */
  maxBoostDb: 4,
  /** The boom trails the crack by this long so their transients do not stack (s). */
  boomDelayS: 0.02,
  /** Pitch drop of the boom at full scale (cents): a big shot is deeper. */
  boomPitchDropCents: 350,
  tailMinDelayS: 0.15,
  tailMaxDelayS: 0.4,
  /** Share of the boost the tail follows. */
  tailBoostShare: 0.5,
  /** The ambience dips as the blast is armed to fire (siren stops, air holds its breath). */
  preRollDuck: { amountDb: -8, holdS: 1.2, releaseS: 0.8 },
  /** The ambience is pushed down hard under the blast. */
  duck: { amountDb: -16, holdS: 2.5, releaseS: 1.8 },
  /** Work and haul bursts stay quiet this long after a blast (s). */
  workSuppressS: 2.5,
  /** Timeline entries are handed to the player this far ahead of their start (s): the player counts a scheduled voice as busy from the moment it is scheduled. */
  lookaheadS: 0.35,
  /** An entry later than this when its turn comes (a frame hitch) is dropped rather than piled on (s). */
  lateSkipS: 0.6,
  /** Fade when playback is skipped and scheduled sounds are cut (s). */
  cancelFadeS: 0.08,
  /** Handles kept for cancelling; older ones have long finished. */
  maxRetainedHandles: 128,
  rain: {
    minBins: 25,
    maxBins: 40,
    /** Flights represented by one bin when choosing the bin count. */
    flightsPerBin: 8,
    /** A bin of at most this many fragments landing slower than `lightMaxSpeed` is pebbles. */
    lightMaxCount: 3,
    lightMaxSpeed: 14,
    /** A bin of at least this many fragments is heavy and sounds lower still. */
    heavyCount: 10,
    heavyExtraDropCents: 200,
    /** Level of the loudest bin when it holds a single fragment, then +10 dB per decade of fragments in it, up to the cap. */
    baseDb: -3,
    maxBoostDb: 6,
    /** Quieter bins sit this far below the loudest at most (dB). */
    minRelativeDb: -12,
    /** Impact speed (m/s) that earns the full pitch drop. */
    impactSpeedRef: 80,
    maxPitchDropCents: 700,
  },
  secondary: {
    maxCount: 3,
    firstDelayS: 0.9,
    spacingS: 0.7,
    jitterS: 0.3,
    /** Lower than the main blast: a distant, heavier thud. */
    boomPitchCents: -500,
    crackPitchCents: -300,
    crackDelayS: 0.02,
    /** Stored explosives that earn the full level. */
    fullScaleKg: 200,
    minGainDb: -6,
    maxGainDb: 1,
  },
  demolish: { maxCount: 3, firstDelayS: 0.35, spacingS: 0.5, gainDb: -2 },
  /** One muted alert for casualties, after the blast has had its say. */
  casualty: { delayS: 1, gainDb: -4 },
  dud: { maxCount: 3, firstDelayS: 0.3, spacingS: 0.35, scatterM: 6, gainDb: -3 },
} as const;

/** The evacuation siren and its countdown beeps. */
export const SIREN_CONFIG = {
  rampInS: 0.4,
  rampOutS: 0.12,
  /** Beep gap with a full crowd still to clear, and when the zone is nearly empty (s). */
  slowIntervalS: 1.6,
  fastIntervalS: 0.35,
  /** Pitch rise of the beep as the zone empties (cents). */
  maxPitchRiseCents: 400,
  /** After the armed state clears, wait this long for the blast to announce itself before calling it a cancel (s). */
  cancelGraceS: 0.45,
} as const;

interface WeatherBedLevels {
  readonly wind: number;
  readonly rainLight: number;
  readonly rainHeavy: number;
}

/** Ambient bed levels (0..1) per weather. */
export const AMBIENCE_CONFIG = {
  /** Cross-fade time between weathers (s). */
  rampS: 3,
  /** Fade when a full-screen menu opens or closes (s). */
  menuRampS: 1.5,
  /** The one thing left audible behind a menu: wind, barely. */
  menuWindLevel: 0.1,
  /** Weather beds while the simulation is paused or the level is over. */
  pausedFactor: 0.55,
  /** Level changes smaller than this are not sent to the player. */
  epsilon: 0.02,
  /** Wind swells a little as the camera pulls back: camera distances (m) mapped to +/- swing. */
  windViewNearM: 20,
  windViewFarM: 120,
  windViewSwing: 0.15,
  weather: {
    sunny: { wind: 0.25, rainLight: 0, rainHeavy: 0 },
    cloudy: { wind: 0.35, rainLight: 0, rainHeavy: 0 },
    light_rain: { wind: 0.4, rainLight: 0.8, rainHeavy: 0 },
    heavy_rain: { wind: 0.6, rainLight: 0, rainHeavy: 0.85 },
    storm: { wind: 0.9, rainLight: 0, rainHeavy: 1 },
    heat_wave: { wind: 0.15, rainLight: 0, rainHeavy: 0 },
    cold_snap: { wind: 0.55, rainLight: 0, rainHeavy: 0 },
  } satisfies Record<WeatherState, WeatherBedLevels>,
  thunder: {
    /** Lightning to thunder, random in this range: how far away the strike feels (s). */
    minDelayS: 0.3,
    maxDelayS: 2.5,
    /** The farthest strike is this much quieter than the nearest (dB). */
    farthestDb: -5,
    /** Distant rumbles between flashes during a storm. */
    rumbleMinIntervalS: 12,
    rumbleMaxIntervalS: 30,
    rumbleMinDb: -12,
    rumbleMaxDb: -8,
  },
} as const;

/** Rare far-away sounds that make the world feel inhabited. */
export const LIFE_CONFIG = {
  minIntervalS: 25,
  maxIntervalS: 70,
  /** Where the sound seems to come from, metres from the listener. */
  minDistanceM: 90,
  maxDistanceM: 220,
  /** Never farther than this share of the engine's cull distance, or the sound would be culled silently. */
  maxCullShare: 0.8,
  minDb: -10,
  maxDb: -6,
  /** Candidate sounds (catalog ids) and their relative odds. */
  sounds: {
    vehicle_scrap: 3,
    vehicle_horn: 2,
    work_hammer: 2,
    haul_dump: 2,
    building_demolished: 1,
  },
} as const;
