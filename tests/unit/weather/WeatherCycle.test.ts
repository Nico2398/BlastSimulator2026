import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createWeatherCycle,
  advanceWeather,
  forceAdvance,
  isRaining,
  ALL_WEATHER_STATES,
} from '../../../src/core/weather/WeatherCycle.js';
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
    const initial = cycle.current;

    // Force several transitions
    const states = new Set<string>();
    for (let i = 0; i < 20; i++) {
      forceAdvance(cycle, rng);
      states.add(cycle.current);
    }

    // Should have visited multiple states
    expect(states.size).toBeGreaterThan(1);
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
