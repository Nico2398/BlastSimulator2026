// BlastSimulator2026 — WeatherAdvisory unit tests

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { computeWeatherAdvisory } from '../../../src/core/weather/WeatherAdvisory.js';
import type { WeatherState } from '../../../src/core/weather/WeatherCycle.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';

function makeHole(id: string): DrillHole {
  return { id, x: 0, z: 0, depth: 8, diameter: 0.15 };
}

describe('computeWeatherAdvisory', () => {
  it('is clear with no wet days anywhere in the horizon', () => {
    const state = createGame({ seed: 1 });
    const forecastDays: WeatherState[] = ['sunny', 'cloudy', 'sunny', 'cloudy', 'sunny'];

    const advisory = computeWeatherAdvisory(state, 'sunny', forecastDays);

    expect(advisory).toEqual({ kind: 'clear', uncoveredHoles: 0, consecutiveWetDays: 0, daysUntilChange: null });
  });

  it('is wet when it is raining today, and counts uncovered holes', () => {
    const state = createGame({ seed: 1 });
    state.drillHoles = [makeHole('H1'), makeHole('H2')];
    state.tubingState.installedHoles = new Set(['H2']);
    const forecastDays: WeatherState[] = ['sunny', 'sunny', 'sunny'];

    const advisory = computeWeatherAdvisory(state, 'heavy_rain', forecastDays);

    expect(advisory.kind).toBe('wet');
    expect(advisory.uncoveredHoles).toBe(1);
  });

  it('wet streak includes today and counts forward to the first dry day', () => {
    const state = createGame({ seed: 1 });
    const forecastDays: WeatherState[] = ['storm', 'light_rain', 'sunny', 'sunny'];

    const advisory = computeWeatherAdvisory(state, 'heavy_rain', forecastDays);

    // today (index 0) + storm (1) + light_rain (2) = 3 wet days, clears at index 3
    expect(advisory).toEqual({ kind: 'wet', uncoveredHoles: 0, consecutiveWetDays: 3, daysUntilChange: 3 });
  });

  it('wet with no clear day within the horizon reports null daysUntilChange', () => {
    const state = createGame({ seed: 1 });
    const forecastDays: WeatherState[] = ['storm', 'heavy_rain', 'light_rain'];

    const advisory = computeWeatherAdvisory(state, 'heavy_rain', forecastDays);

    expect(advisory.kind).toBe('wet');
    expect(advisory.consecutiveWetDays).toBe(4);
    expect(advisory.daysUntilChange).toBeNull();
  });

  it('flags rain incoming when today is dry but rain starts later', () => {
    const state = createGame({ seed: 1 });
    const forecastDays: WeatherState[] = ['cloudy', 'sunny', 'light_rain', 'heavy_rain', 'sunny'];

    const advisory = computeWeatherAdvisory(state, 'sunny', forecastDays);

    // today(0)=sunny, cloudy(1), sunny(2), light_rain(3), heavy_rain(4), sunny(5): rain runs 3..4
    expect(advisory).toEqual({ kind: 'rain_incoming', uncoveredHoles: 0, consecutiveWetDays: 2, daysUntilChange: 3 });
  });

  it('rain incoming that never clears within the horizon reports null daysUntilChange for the clear side, but a real start day', () => {
    const state = createGame({ seed: 1 });
    const forecastDays: WeatherState[] = ['sunny', 'storm', 'storm'];

    const advisory = computeWeatherAdvisory(state, 'cloudy', forecastDays);

    expect(advisory.kind).toBe('rain_incoming');
    expect(advisory.daysUntilChange).toBe(2);
    expect(advisory.consecutiveWetDays).toBe(2);
  });

  it('uncoveredHoles is always 0 when it is not currently raining, regardless of forecast', () => {
    const state = createGame({ seed: 1 });
    state.drillHoles = [makeHole('H1')];
    state.tubingState.installedHoles = new Set();
    const forecastDays: WeatherState[] = ['storm', 'storm'];

    const advisory = computeWeatherAdvisory(state, 'sunny', forecastDays);

    expect(advisory.uncoveredHoles).toBe(0);
  });
});
