// BlastSimulator2026 — rainWithinTicks: does it rain now or in the next N ticks? (#2149)

import { describe, it, expect } from 'vitest';
import {
  rainWithinTicks,
  tickWeather,
  isRaining,
  createWeatherCycle,
  ALL_WEATHER_STATES,
  type WeatherCycleState,
} from '../../../src/core/weather/WeatherCycle.js';
import { pinnedDryCycle, pinnedCycle, rainAfterCycle } from '../../helpers/weatherCycles.js';

/** Reference answer: tick a copy and look for rain at ticks 1..n, with no help from the function under test. */
function rainByManualSim(cycle: WeatherCycleState, n: number, biomeId?: string): boolean {
  if (isRaining(cycle.current)) return true;
  const sim: WeatherCycleState = { ...cycle, history: [] };
  for (let i = 0; i < n; i++) {
    tickWeather(sim, biomeId);
    if (isRaining(sim.current)) return true;
  }
  return false;
}

describe('rainWithinTicks (#2149)', () => {
  it.each(['light_rain', 'heavy_rain', 'storm'] as const)('is true when %s is falling now, whatever the horizon', state => {
    const cycle = pinnedCycle(state);
    expect(rainWithinTicks(cycle, 24)).toBe(true);
    expect(rainWithinTicks(cycle, 1)).toBe(true);
    expect(rainWithinTicks(cycle, 0)).toBe(true);
  });

  it.each(ALL_WEATHER_STATES.filter(s => s !== 'light_rain' && s !== 'heavy_rain' && s !== 'storm'))(
    'is false for a pinned %s cycle, which never changes',
    state => {
      expect(rainWithinTicks(pinnedCycle(state), 24)).toBe(false);
      expect(rainWithinTicks(pinnedCycle(state), 500)).toBe(false);
    },
  );

  it('is true when rain arrives inside the horizon', () => {
    const cycle = rainAfterCycle(5);
    expect(isRaining(cycle.current)).toBe(false);
    expect(rainWithinTicks(cycle, 24)).toBe(true);
  });

  it('counts the last tick of the horizon: rain arriving on tick 24 is within 24 ticks', () => {
    expect(rainWithinTicks(rainAfterCycle(24), 24)).toBe(true);
  });

  it('is false when rain arrives only after the horizon', () => {
    expect(rainWithinTicks(rainAfterCycle(26), 24)).toBe(false);
    expect(rainWithinTicks(rainAfterCycle(40), 24)).toBe(false);
  });

  it('a longer horizon sees rain a shorter one misses', () => {
    const cycle = rainAfterCycle(30);
    expect(rainWithinTicks(cycle, 10)).toBe(false);
    expect(rainWithinTicks(cycle, 30)).toBe(true);
    expect(rainWithinTicks(cycle, 60)).toBe(true);
  });

  it('ticks <= 0 only checks the current weather', () => {
    const rainSoon = rainAfterCycle(1);
    expect(rainWithinTicks(rainSoon, 0)).toBe(false);
    expect(rainWithinTicks(rainSoon, -5)).toBe(false);
    expect(rainWithinTicks(pinnedCycle('storm'), -5)).toBe(true);
    expect(rainWithinTicks(pinnedDryCycle(), 0)).toBe(false);
  });

  it('leaves the live cycle untouched, rng state and history included', () => {
    const cycle = rainAfterCycle(10);
    cycle.history = ['sunny', 'cloudy', 'sunny'];
    const before = JSON.parse(JSON.stringify(cycle)) as WeatherCycleState;

    rainWithinTicks(cycle, 24);
    rainWithinTicks(cycle, 500);

    expect(cycle).toEqual(before);
  });

  it('gives the same answer when called twice (no hidden state)', () => {
    const cycle = rainAfterCycle(12);
    expect(rainWithinTicks(cycle, 24)).toBe(rainWithinTicks(cycle, 24));
  });

  it('agrees with ticking a copy of the cycle, across seeds and horizons', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const cycle = createWeatherCycle(seed);
      for (const n of [0, 1, 6, 24, 48]) {
        expect(rainWithinTicks(cycle, n)).toBe(rainByManualSim(cycle, n));
      }
    }
  });

  it('forecasts with the biome climate it is given', () => {
    for (const biome of ['desert', 'tropical', 'alpine', 'temperate']) {
      for (let seed = 1; seed <= 25; seed++) {
        const cycle = createWeatherCycle(seed, undefined, biome);
        expect(rainWithinTicks(cycle, 48, biome)).toBe(rainByManualSim(cycle, 48, biome));
      }
    }
  });
});
