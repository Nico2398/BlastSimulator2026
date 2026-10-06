import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createWeatherCycle,
  advanceWeather,
  forceAdvance,
  setWeather,
  forecast,
  tickWeather,
  forceAdvanceInState,
  ALL_WEATHER_STATES,
  type WeatherState,
} from '../../../src/core/weather/WeatherCycle.js';
import { WEATHER_HISTORY_MAX } from '../../../src/core/config/balance.js';
import {
  updateHoleFlooding,
  isHoleFlooded,
  willChargeFail,
  type HoleFloodState,
} from '../../../src/core/weather/WeatherEffects.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';

describe('WeatherCycle', () => {
  it('produces deterministic sequence from a given seed', () => {
    const cycle1 = createWeatherCycle(42);
    const rng1 = new Random(42);
    const cycle2 = createWeatherCycle(42);
    const rng2 = new Random(42);

    const seq1: string[] = [];
    const seq2: string[] = [];

    for (let i = 0; i < 50; i++) {
      advanceWeather(cycle1, rng1);
      seq1.push(cycle1.current);
    }
    for (let i = 0; i < 50; i++) {
      advanceWeather(cycle2, rng2);
      seq2.push(cycle2.current);
    }

    expect(seq1).toEqual(seq2);
  });

  it('weather transitions follow valid state transitions', () => {
    const cycle = createWeatherCycle(123);
    const rng = new Random(123);

    for (let i = 0; i < 100; i++) {
      advanceWeather(cycle, rng);
      expect(ALL_WEATHER_STATES).toContain(cycle.current);
    }
  });

  it('forceAdvance transitions immediately', () => {
    const cycle = createWeatherCycle(99);
    const rng = new Random(99);

    // Force several transitions
    const states = new Set<string>();
    for (let i = 0; i < 20; i++) {
      forceAdvance(cycle, rng);
      states.add(cycle.current);
    }

    // Should have visited multiple states
    expect(states.size).toBeGreaterThan(1);
  });

  it('setWeather forces the cycle directly to the given state', () => {
    const cycle = createWeatherCycle(7);
    const target: WeatherState = 'heavy_rain';

    setWeather(cycle, target);

    expect(cycle.current).toBe(target);
    expect(cycle.ticksRemaining).toBeGreaterThan(0);
  });

  it('setWeather records the forced state in history', () => {
    const cycle = createWeatherCycle(7);
    const historyLengthBefore = cycle.history.length;

    setWeather(cycle, 'storm');

    expect(cycle.history.length).toBe(historyLengthBefore + 1);
    expect(cycle.history[cycle.history.length - 1]).toBe('storm');
  });

  it('setWeather works for every valid weather state', () => {
    const cycle = createWeatherCycle(7);
    for (const state of ALL_WEATHER_STATES) {
      setWeather(cycle, state);
      expect(cycle.current).toBe(state);
    }
  });
});

describe('forecast', () => {
  it('is deterministic for a given cycle and rng state', () => {
    const cycleA = createWeatherCycle(42);
    const cycleB = createWeatherCycle(42);

    const a = forecast(cycleA, 14);
    const b = forecast(cycleB, 14);

    expect(a).toEqual(b);
  });

  it('returns n entries, one per day', () => {
    const cycle = createWeatherCycle(3);
    expect(forecast(cycle, 14)).toHaveLength(14);
    expect(forecast(cycle, 5)).toHaveLength(5);
  });

  it('every entry is a valid weather state', () => {
    const cycle = createWeatherCycle(9);
    for (const day of forecast(cycle, 14)) {
      expect(ALL_WEATHER_STATES).toContain(day);
    }
  });

  it('does not mutate the cycle it was given', () => {
    const cycle = createWeatherCycle(11);
    const before = { current: cycle.current, ticksRemaining: cycle.ticksRemaining, history: [...cycle.history] };

    forecast(cycle, 14);

    expect(cycle.current).toBe(before.current);
    expect(cycle.ticksRemaining).toBe(before.ticksRemaining);
    expect(cycle.history).toEqual(before.history);
  });

  it('does not consume the rng it was given', () => {
    const cycle = createWeatherCycle(17);
    const rng = new Random(17);
    const expected = new Random(17).next();

    forecast(cycle, 14);

    expect(rng.next()).toBe(expected);
  });

  it('a longer horizon extends, rather than reruns, a shorter one', () => {
    const short = forecast(createWeatherCycle(21), 5);
    const long = forecast(createWeatherCycle(21), 14);

    expect(long.slice(0, 5)).toEqual(short);
  });
});

describe('WeatherEffects', () => {
  const testHole: DrillHole = { id: 'h1', x: 5, z: 5, depth: 8, diameter: 0.15 };

  it('heavy rain on porous rock floods unfilled holes', () => {
    let flood: HoleFloodState = { waterLevel: 0, hasTubing: false };

    // Simulate heavy rain for many ticks on porous rock (porosity 0.35)
    // Rate: 0.7 * 0.35 * 0.3 = 0.0735/tick. Need 2.4m (30% of 8m depth): ~33 ticks
    for (let i = 0; i < 40; i++) {
      flood = updateHoleFlooding(testHole, flood, 'heavy_rain', 0.35);
    }

    expect(flood.waterLevel).toBeGreaterThan(0);
    expect(isHoleFlooded(flood, testHole.depth)).toBe(true);
  });

  it('tubing prevents hole flooding', () => {
    let flood: HoleFloodState = { waterLevel: 0, hasTubing: true };

    for (let i = 0; i < 50; i++) {
      flood = updateHoleFlooding(testHole, flood, 'heavy_rain', 0.35);
    }

    expect(flood.waterLevel).toBe(0);
  });

  it('flooded hole + water-sensitive explosive → charge fails', () => {
    const flood: HoleFloodState = { waterLevel: 5, hasTubing: false };
    const charge = { explosiveId: 'boomite', amountKg: 3, stemmingM: 2 }; // boomite is water-sensitive

    expect(willChargeFail(charge, flood, 8)).toBe(true);
  });

  it('flooded hole + water-resistant explosive → charge ok', () => {
    const flood: HoleFloodState = { waterLevel: 5, hasTubing: false };
    const charge = { explosiveId: 'krackle', amountKg: 3, stemmingM: 2 }; // krackle is water-resistant

    expect(willChargeFail(charge, flood, 8)).toBe(false);
  });

  it('tubed hole + water-sensitive explosive → charge ok', () => {
    const flood: HoleFloodState = { waterLevel: 5, hasTubing: true };
    const charge = { explosiveId: 'boomite', amountKg: 3, stemmingM: 2 };

    expect(willChargeFail(charge, flood, 8)).toBe(false);
  });
});

describe('tickWeather (#1403)', () => {
  it('returns the cycle\'s current state', () => {
    const cycle = createWeatherCycle(42);
    for (let i = 0; i < 60; i++) {
      expect(tickWeather(cycle)).toBe(cycle.current);
    }
  });

  it('matches advanceWeather driven by Random.fromState(rngState)', () => {
    const a = createWeatherCycle(7);
    const b = structuredClone(a);
    const rng = Random.fromState(b.rngState);
    for (let i = 0; i < 500; i++) {
      tickWeather(a);
      advanceWeather(b, rng);
      expect(a.current).toBe(b.current);
      expect(a.ticksRemaining).toBe(b.ticksRemaining);
    }
  });

  it('persists the advanced PRNG state in rngState', () => {
    const cycle = createWeatherCycle(7);
    const initial = cycle.rngState;
    for (let i = 0; i < 100; i++) tickWeather(cycle);
    expect(cycle.rngState).not.toBe(initial);
  });

  it('a structuredClone mid-run continues identically', () => {
    const a = createWeatherCycle(11);
    for (let i = 0; i < 37; i++) tickWeather(a);
    const b = structuredClone(a);
    for (let i = 0; i < 200; i++) {
      tickWeather(a);
      tickWeather(b);
    }
    expect(b).toEqual(a);
  });

  it('is deterministic per seed and differs across seeds', () => {
    const run = (seed: number) => {
      const c = createWeatherCycle(seed);
      for (let i = 0; i < 1000; i++) tickWeather(c);
      return c.history.join(',');
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it('caps history at WEATHER_HISTORY_MAX over a very long run', () => {
    const cycle = createWeatherCycle(3);
    for (let i = 0; i < 10000; i++) tickWeather(cycle);
    expect(cycle.history.length).toBeLessThanOrEqual(WEATHER_HISTORY_MAX);
    expect(cycle.history[cycle.history.length - 1]).toBe(cycle.current);
  });

  it('only ever yields valid states', () => {
    const cycle = createWeatherCycle(99);
    for (let i = 0; i < 2000; i++) expect(ALL_WEATHER_STATES).toContain(tickWeather(cycle));
  });
});

describe('forceAdvanceInState (#1403)', () => {
  it('moves to a new duration window and records the state in history', () => {
    const cycle = createWeatherCycle(42);
    const before = cycle.history.length;
    forceAdvanceInState(cycle);
    expect(ALL_WEATHER_STATES).toContain(cycle.current);
    expect(cycle.ticksRemaining).toBeGreaterThan(0);
    expect(cycle.history[cycle.history.length - 1]).toBe(cycle.current);
    expect(cycle.history.length).toBeGreaterThanOrEqual(Math.min(before + 1, WEATHER_HISTORY_MAX));
  });

  it('advances rngState and is reproducible from a clone', () => {
    const a = createWeatherCycle(42);
    const b = structuredClone(a);
    forceAdvanceInState(a);
    forceAdvanceInState(b);
    expect(a).toEqual(b);
    expect(a.rngState).not.toBe(42);
  });
});

describe('forecast vs tickWeather (#1403)', () => {
  it.each([1, 2, 5, 14])('forecast(cycle, n)[n-1] equals state after n*24 ticks (n=%i)', (n) => {
    const cycle = createWeatherCycle(123);
    for (let i = 0; i < 50; i++) tickWeather(cycle);
    const predicted = forecast(cycle, n);
    const live = structuredClone(cycle);
    for (let i = 0; i < n * 24; i++) tickWeather(live);
    expect(predicted[n - 1]).toBe(live.current);
  });
});
