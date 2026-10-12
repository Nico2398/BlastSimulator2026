// BlastSimulator2026 — Mix scenario shapes
// A mix scenario is data: a timeline of sound requests for the lab to play, live or
// into an offline render. Events are what a director would ask of the AudioPlayer,
// with a time on the scenario clock instead of "now".

import type { Listener, PlayOptions } from '../AudioPlayer.js';
import type { LoopId, OneShotId, SoundBus } from '../SoundCatalog.js';

/** Fire a one-shot. `opts.delayS` is not allowed: the event's own time is the delay. */
export interface PlayMixEvent {
  readonly kind: 'play';
  /** Seconds from the start of the scenario. */
  readonly t: number;
  readonly id: OneShotId;
  readonly opts?: Omit<PlayOptions, 'delayS'>;
}

/** Ramp a looped bed to a level (0 releases it). */
export interface LoopMixEvent {
  readonly kind: 'loop';
  readonly t: number;
  readonly id: LoopId;
  readonly level: number;
  readonly rampS?: number;
}

/** Pull a bus down, as the blast director does for the ambience. */
export interface DuckMixEvent {
  readonly kind: 'duck';
  readonly t: number;
  readonly bus: SoundBus;
  readonly amountDb: number;
  readonly holdS: number;
  readonly releaseS: number;
}

export type MixEvent = PlayMixEvent | LoopMixEvent | DuckMixEvent;

export const MIX_SCENARIO_NAMES = ['ui-tour', 'blast', 'busy-mine'] as const;
export type MixScenarioName = (typeof MIX_SCENARIO_NAMES)[number];

export function isMixScenarioName(value: string): value is MixScenarioName {
  return (MIX_SCENARIO_NAMES as readonly string[]).includes(value);
}

export interface MixScenario {
  readonly name: MixScenarioName;
  readonly title: string;
  /** Length of the render: the last event plus room for its tail (s). */
  readonly durationS: number;
  readonly listener: Listener;
  /** Sorted by time. */
  readonly events: readonly MixEvent[];
}
