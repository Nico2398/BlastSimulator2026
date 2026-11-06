// BlastSimulator2026 — weather cycle fixtures (#2149)
//
// Hand-built cycles whose next weather change is known, found by ticking a copy with
// tickWeather itself, so nothing here depends on the code that looks ahead.

import { tickWeather, isRaining, type WeatherCycleState, type WeatherState } from '../../src/core/weather/WeatherCycle.js';

/** A sunny cycle pinned for the whole game: it never rains, however far ahead one looks. */
export function pinnedDryCycle(): WeatherCycleState {
  return { current: 'sunny', ticksRemaining: 9999, history: ['sunny'], rngState: 1, pinned: true };
}

/** A pinned cycle in `state` (raining now when `state` is a rain state). */
export function pinnedCycle(state: WeatherState): WeatherCycleState {
  return { current: state, ticksRemaining: 9999, history: [state], rngState: 1, pinned: true };
}

/**
 * A free-running sunny cycle whose sunny spell ends after exactly `ticksUntilChange` ticks, the change
 * landing on a rain state. Raining first happens on tick `ticksUntilChange` of the forecast and not before.
 */
export function rainAfterCycle(ticksUntilChange: number, biomeId?: string): WeatherCycleState {
  for (let rngState = 1; rngState < 20000; rngState++) {
    const cycle: WeatherCycleState = { current: 'sunny', ticksRemaining: ticksUntilChange, history: ['sunny'], rngState };
    const probe: WeatherCycleState = { ...cycle, history: [] };
    let firstRain = -1;
    for (let tick = 1; tick <= ticksUntilChange + 1; tick++) {
      tickWeather(probe, biomeId);
      if (isRaining(probe.current)) { firstRain = tick; break; }
    }
    if (firstRain === ticksUntilChange) return cycle;
  }
  throw new Error(`no seed rains after exactly ${ticksUntilChange} ticks`);
}

/** A free-running sunny cycle that stays free of rain through its next `ticks` ticks, yet is not pinned. */
export function dryForCycle(ticks: number, biomeId?: string): WeatherCycleState {
  for (let rngState = 1; rngState < 20000; rngState++) {
    const cycle: WeatherCycleState = { current: 'sunny', ticksRemaining: ticks + 2, history: ['sunny'], rngState };
    const probe: WeatherCycleState = { ...cycle, history: [] };
    let rained = false;
    for (let tick = 1; tick <= ticks; tick++) {
      tickWeather(probe, biomeId);
      if (isRaining(probe.current)) rained = true;
    }
    if (!rained) return cycle;
  }
  throw new Error(`no seed stays dry for ${ticks} ticks`);
}
