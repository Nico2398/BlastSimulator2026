// BlastSimulator2026 — Audio player contract
// What every game-facing audio director (UI sounds, gameplay cues, blasts,
// ambience) is allowed to know about sound playback. The Web Audio engine
// implements it; tests and headless runs use NULL_AUDIO_PLAYER or a recording
// fake, so no director ever needs an AudioContext.

import type { LoopId, OneShotId, SoundBus } from './SoundCatalog.js';

/** A point on the ground, in world metres (the same x/z the renderer and core share). */
export interface WorldPoint {
  readonly x: number;
  readonly z: number;
}

export interface PlayOptions {
  /** Where the sound happens. Positional sounds are panned, attenuated and filtered by distance from the listener. */
  readonly at?: WorldPoint;
  /** Extra level in dB on top of the catalog trim (scale a sound by how big the event is). */
  readonly gainDb?: number;
  /** Seconds from now before the sound starts, on the audio clock (sample-accurate, immune to frame hitches). */
  readonly delayS?: number;
  /** Cooldown key; plays sharing a key within the sound's cooldown are dropped. Default: the sound id. */
  readonly key?: string;
  /** Fixed extra pitch shift in cents, added to the random jitter. */
  readonly pitchCents?: number;
  /** Play on another bus than the catalog's (distant "life" sounds go to the ambient bus). */
  readonly bus?: SoundBus;
}

export interface LoopOptions {
  /** Starting level 0..1 (default 0: silent until `setLevel`). */
  readonly level?: number;
  /** Seconds to ramp to the starting level. */
  readonly rampS?: number;
}

export interface SoundHandle {
  /** Stop the sound, fading out over `fadeS` seconds (default: a few ms to avoid a click). */
  stop(fadeS?: number): void;
}

export interface LoopHandle extends SoundHandle {
  /** Ramp the bed to `level` (0..1) over `rampS` seconds. Level 0 releases the underlying voice. */
  setLevel(level: number, rampS?: number): void;
}

/** Where the player is listening from: the camera's ground target and its right-hand direction. */
export interface Listener {
  readonly x: number;
  readonly z: number;
  /** Unit vector pointing to the listener's right on the ground plane. */
  readonly rightX: number;
  readonly rightZ: number;
  /** Camera distance to the target in metres: a zoomed-in camera hears a smaller neighbourhood. */
  readonly viewDistance: number;
}

export interface AudioPlayer {
  /** True once the interface and blast cues are decoded; `play` drops sounds before that. */
  readonly ready: boolean;
  /** Fire a one-shot. Returns null when the sound was dropped (cooldown, voice budget, not loaded, muted). */
  play(id: OneShotId, opts?: PlayOptions): SoundHandle | null;
  /** Get a looped bed. The handle is cheap and reusable; the underlying voice only runs while its level is above 0. */
  loop(id: LoopId, opts?: LoopOptions): LoopHandle;
  /** Pull a bus down by `amountDb` (negative), hold, then release back to unity. Overlapping ducks keep the deeper one. */
  duck(bus: SoundBus, amountDb: number, holdS: number, releaseS: number): void;
  /** Update where the listener is; called once per frame while a game is on screen. */
  setListener(listener: Listener): void;
}

const NULL_HANDLE: LoopHandle = {
  stop: () => undefined,
  setLevel: () => undefined,
};

/** Player that plays nothing: scenario runs, console mode, browsers without Web Audio. */
export const NULL_AUDIO_PLAYER: AudioPlayer = {
  ready: false,
  play: () => null,
  loop: () => NULL_HANDLE,
  duck: () => undefined,
  setListener: () => undefined,
};
