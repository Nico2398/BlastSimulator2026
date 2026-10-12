// BlastSimulator2026 — Interface sound tuning (pure data)
// Rate limits, pitch and level offsets for the sounds the interface layer plays.
// Times in milliseconds unless the name says seconds, pitch in cents, level in dB.

export const UI_SOUND_CONFIG = {
  /** Smallest gap between two hover ticks: sweeping across a toolbar should patter, not buzz. */
  hoverMinGapMs: 80,
  /** Smallest gap between two slider or dropdown value cues (a drag fires an `input` event per pixel). */
  valueMinGapMs: 60,
  /** Smallest gap between two "denied" cues from disabled controls. */
  deniedMinGapMs: 200,
  /** Destructive buttons click lower and a touch softer than ordinary ones. */
  dangerPitchCents: -200,
  dangerGainDb: -1,
  /** A slider's tick rises across its travel by this many cents (centred on its midpoint). */
  sliderPitchSpanCents: 400,
  /**
   * A click cue waits this long (a macrotask) before playing, so the command the click ran can claim the moment
   * with its own cue and the generic click stays out of the way.
   */
  claimDeferMs: 0,
  /**
   * After a key press, a pointer that has not moved since is not hovering anything new: closing a panel with Escape
   * puts whatever lay beneath it under the resting pointer. Hover ticks stay silent for this long, or until the
   * pointer moves, whichever comes first.
   */
  hoverKeyboardQuietMs: 700,
} as const;

/**
 * Where players read the audio credits and licences (public/audio/credits.html renders CREDITS.md). The CC-BY
 * attribution the sound banks require has to be reachable from the running game; the Settings panel opens this.
 * Absolute on the page origin, like the model and sample URLs.
 */
export const AUDIO_CREDITS_URL = '/audio/credits.html';

/** Extra pitch per selected thing, so workers, vehicles and buildings are subtly different without being different sounds. */
export const UI_SELECTION_PITCH_CENTS = {
  employee: 150,
  vehicle: -150,
  building: -350,
  hole: 300,
  ramp: -250,
  fragment: 500,
} as const;

/** How command cues are shaped in time. */
export const UI_COMMAND_CONFIG = {
  /** Engine start follows a vehicle purchase by this long, so the two cues read as cause and effect. */
  vehicleStartDelayS: 0.25,
} as const;
