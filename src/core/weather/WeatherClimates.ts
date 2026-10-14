// BlastSimulator2026 — Per-biome weather climates (#1688)
// A climate bundles the transition weights and state durations a biome's weather cycle runs on.

import type { WeatherState } from './WeatherCycle.js';

export interface WeatherClimate {
  /** Weighted next-state options per state (weights are normalized at runtime). */
  transitions: Record<WeatherState, Array<[WeatherState, number]>>;
  /** Inclusive [min, max] tick duration per state. */
  durations: Record<WeatherState, [min: number, max: number]>;
}

/** Climate for a biome id; unknown or undefined ids get the temperate climate. */
export function getWeatherClimate(_biomeId: string | undefined): WeatherClimate {
  // TODO: implement
  throw new Error('not implemented');
}
