// BlastSimulator2026 — Weather advisory derivation (redesign P7)
// What the weather popover's advisory line needs, read off the forecast and
// the currently-uncovered holes in the same priority a player needs to see
// it: wet right now is the urgent case, rain arriving is a heads-up, clear
// needs no line at all. Locale-agnostic: returns a kind + raw data, never
// player-facing text — mirrors EmployeeActivity.ts/VehicleStatus.ts.

import type { GameState } from '../state/GameState.js';
import { isRaining, type WeatherState } from './WeatherCycle.js';
import { wetHoles } from '../mining/WetHoles.js';

export type WeatherAdvisoryKind = 'clear' | 'wet' | 'rain_incoming';

export interface WeatherAdvisory {
  kind: WeatherAdvisoryKind;
  /** Holes exposed to rain right now (wetHoles against the live weather). */
  uncoveredHoles: number;
  /** Consecutive rainy days the streak covers: for 'wet', including today; for 'rain_incoming', the incoming stretch. Always 0 for 'clear'. */
  consecutiveWetDays: number;
  /** Days from today until the wet stretch ends ('wet') or begins ('rain_incoming'); null if it doesn't resolve within the forecast horizon. */
  daysUntilChange: number | null;
}

/**
 * `current` and `forecastDays` (from `forecast()`) are concatenated into one
 * sequence — index 0 is today — so a streak that's already running today
 * and one that starts tomorrow share the same walk-forward logic.
 */
export function computeWeatherAdvisory(
  state: GameState,
  current: WeatherState,
  forecastDays: readonly WeatherState[],
): WeatherAdvisory {
  const uncoveredHoles = wetHoles(state, current).length;
  const sequence: WeatherState[] = [current, ...forecastDays];

  if (isRaining(current)) {
    let end = 1;
    while (end < sequence.length && isRaining(sequence[end]!)) end++;
    return {
      kind: 'wet',
      uncoveredHoles,
      consecutiveWetDays: end,
      daysUntilChange: end < sequence.length ? end : null,
    };
  }

  const wetIdx = sequence.findIndex((w, i) => i > 0 && isRaining(w));
  if (wetIdx === -1) {
    return { kind: 'clear', uncoveredHoles, consecutiveWetDays: 0, daysUntilChange: null };
  }
  let end = wetIdx;
  while (end < sequence.length && isRaining(sequence[end]!)) end++;
  return {
    kind: 'rain_incoming',
    uncoveredHoles,
    consecutiveWetDays: end - wetIdx,
    daysUntilChange: wetIdx,
  };
}
