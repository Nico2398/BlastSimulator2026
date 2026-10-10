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
  rainIntensity,
  type WeatherState,
} from '../../../src/core/weather/WeatherCycle.js';
import {
  WEATHER_HISTORY_MAX,
  HOLE_WET_THRESHOLD,
  GROUND_WETNESS_RISE_RATE,
  GROUND_WETNESS_DECAY_RATE,
} from '../../../src/core/config/balance.js';
import {
  advanceHoleWater,
  advanceGroundWetness,
  isHoleFlooded,
  type HoleWater,
} from '../../../src/core/weather/WeatherEffects.js';

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

  it('leaves the cycle rngState unchanged', () => {
    const cycle = createWeatherCycle(17);
    const rngBefore = cycle.rngState;

    forecast(cycle, 14);

    expect(cycle.rngState).toBe(rngBefore);
  });

  it('a longer horizon extends, rather than reruns, a shorter one', () => {
    const short = forecast(createWeatherCycle(21), 5);
    const long = forecast(createWeatherCycle(21), 14);

    expect(long.slice(0, 5)).toEqual(short);
  });
});

describe('WeatherEffects — hole water (#1350)', () => {
  const dry = (porosity: number): HoleWater => ({ level: 0, porosity });
  const run = (hw: HoleWater, ticks: number, rain: number, ground: number, tubed: boolean): HoleWater => {
    let cur = hw;
    for (let i = 0; i < ticks; i++) cur = advanceHoleWater(cur, rain, ground, tubed);
    return cur;
  };
  const ticksUntilDry = (start: HoleWater, rain: number, ground: number, max = 400): number => {
    let cur = start;
    for (let i = 1; i <= max; i++) {
      cur = advanceHoleWater(cur, rain, ground, false);
      if (cur.level <= 0) return i;
    }
    return max + 1;
  };

  it('a dry hole with no rain and dry ground stays at level 0', () => {
    expect(run(dry(0.35), 50, 0, 0, false).level).toBe(0);
    expect(run(dry(0.03), 50, 0, 0, false).level).toBe(0);
  });

  it('an untubed hole in a storm exceeds the wet threshold within 2 ticks', () => {
    const hw = run(dry(0.03), 2, rainIntensity('storm'), 0, false);
    expect(hw.level).toBeGreaterThan(HOLE_WET_THRESHOLD);
    expect(isHoleFlooded(hw.level)).toBe(true);
  });

  it('light rain fills a hole slower than a storm', () => {
    const light = run(dry(0.03), 2, rainIntensity('light_rain'), 0, false);
    const storm = run(dry(0.03), 2, rainIntensity('storm'), 0, false);
    expect(light.level).toBeGreaterThan(0);
    expect(light.level).toBeLessThan(storm.level);
  });

  it('light rain still floods a hole if it keeps raining long enough', () => {
    const hw = run(dry(0.03), 20, rainIntensity('light_rain'), 0, false);
    expect(isHoleFlooded(hw.level)).toBe(true);
  });

  it('the level never exceeds 1 (full) and never goes below 0', () => {
    const full = run(dry(0.03), 100, 1, 1, false);
    expect(full.level).toBeLessThanOrEqual(1);
    const drained = run({ level: 0.1, porosity: 0.03 }, 100, 0, 0, false);
    expect(drained.level).toBe(0);
  });

  it('a tubed dry hole never rises, in a storm on soaked ground', () => {
    const hw = run(dry(0.35), 100, 1, 1, true);
    expect(hw.level).toBe(0);
  });

  it('a tubed already-wet hole keeps its level: no fill, no fade', () => {
    const wet: HoleWater = { level: 0.6, porosity: 0.35 };
    expect(run(wet, 50, 1, 1, true).level).toBe(0.6);
    expect(run(wet, 50, 0, 0, true).level).toBe(0.6);
  });

  it('advanceHoleWater preserves the hole porosity and does not mutate its input', () => {
    const input: HoleWater = { level: 0.2, porosity: 0.35 };
    const out = advanceHoleWater(input, 1, 0, false);
    expect(out.porosity).toBe(0.35);
    expect(input).toEqual({ level: 0.2, porosity: 0.35 });
  });

  it('a porous hole (0.35) takes water from wet ground after the rain stops', () => {
    const hw = run(dry(0.35), 100, 0, 1, false);
    expect(hw.level).toBeGreaterThan(0);
    expect(isHoleFlooded(hw.level)).toBe(true);
  });

  it('a tight hole (0.03) does not take water from wet ground', () => {
    const hw = run(dry(0.03), 100, 0, 1, false);
    expect(isHoleFlooded(hw.level)).toBe(false);
  });

  it('seep from wet ground is stronger on wetter ground', () => {
    const damp = run(dry(0.35), 30, 0, 0.5, false);
    const soaked = run(dry(0.35), 30, 0, 1, false);
    expect(soaked.level).toBeGreaterThan(0);
    expect(soaked.level).toBeGreaterThanOrEqual(damp.level);
  });

  it('a tubed porous hole takes nothing from wet ground', () => {
    expect(run(dry(0.35), 100, 0, 1, true).level).toBe(0);
  });

  it('water fades to dry once rain stops and the ground is dry, in tight and porous rock', () => {
    expect(ticksUntilDry({ level: 1, porosity: 0.03 }, 0, 0)).toBeLessThanOrEqual(400);
    expect(ticksUntilDry({ level: 1, porosity: 0.35 }, 0, 0)).toBeLessThanOrEqual(400);
  });

  it('water fades slower in porous rock than in tight rock', () => {
    const tight = ticksUntilDry({ level: 1, porosity: 0.03 }, 0, 0);
    const porous = ticksUntilDry({ level: 1, porosity: 0.35 }, 0, 0);
    expect(porous).toBeGreaterThan(tight);
  });

  it('fade is slower the higher the porosity (monotone)', () => {
    const a = ticksUntilDry({ level: 1, porosity: 0.1 }, 0, 0);
    const b = ticksUntilDry({ level: 1, porosity: 0.2 }, 0, 0);
    const c = ticksUntilDry({ level: 1, porosity: 0.3 }, 0, 0);
    expect(a).toBeLessThanOrEqual(b);
    expect(b).toBeLessThanOrEqual(c);
    expect(a).toBeLessThan(c);
  });

  it('a wet hole is drier next tick when nothing is arriving', () => {
    const next = advanceHoleWater({ level: 0.8, porosity: 0.03 }, 0, 0, false);
    expect(next.level).toBeLessThan(0.8);
    expect(next.level).toBeGreaterThan(0);
  });
});

describe('advanceGroundWetness (#1350)', () => {
  it('rises with rain', () => {
    expect(advanceGroundWetness(0, 1)).toBeGreaterThan(0);
  });

  it('rises faster in heavier rain', () => {
    expect(advanceGroundWetness(0, rainIntensity('storm')))
      .toBeGreaterThan(advanceGroundWetness(0, rainIntensity('light_rain')));
  });

  it('rises by GROUND_WETNESS_RISE_RATE per unit of rain from dry', () => {
    expect(advanceGroundWetness(0, 1)).toBeCloseTo(GROUND_WETNESS_RISE_RATE, 6);
  });

  it('decays when it is not raining', () => {
    const next = advanceGroundWetness(0.5, 0);
    expect(next).toBeLessThan(0.5);
    expect(next).toBeCloseTo(0.5 - GROUND_WETNESS_DECAY_RATE, 6);
  });

  it('is clamped to [0, 1]', () => {
    expect(advanceGroundWetness(0.99, 1)).toBe(1);
    expect(advanceGroundWetness(1, 1)).toBe(1);
    expect(advanceGroundWetness(0.01, 0)).toBe(0);
    expect(advanceGroundWetness(0, 0)).toBe(0);
  });

  it('soaks to 1 in a long storm and dries to 0 afterwards', () => {
    let w = 0;
    for (let i = 0; i < 40; i++) w = advanceGroundWetness(w, 1);
    expect(w).toBe(1);
    for (let i = 0; i < 100; i++) w = advanceGroundWetness(w, 0);
    expect(w).toBe(0);
  });
});

describe('isHoleFlooded (#1350)', () => {
  it('is true past HOLE_WET_THRESHOLD and false at or below zero water', () => {
    expect(isHoleFlooded(HOLE_WET_THRESHOLD + 0.01)).toBe(true);
    expect(isHoleFlooded(1)).toBe(true);
    expect(isHoleFlooded(HOLE_WET_THRESHOLD - 0.01)).toBe(false);
    expect(isHoleFlooded(0)).toBe(false);
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

describe('pinned weather cycle (#1585)', () => {
  it('createWeatherCycle(seed, state) pins to that state', () => {
    const c = createWeatherCycle(42, 'sunny');
    expect(c.current).toBe('sunny');
    expect(c.pinned).toBe(true);
  });

  it('pins to a non-default state too', () => {
    const c = createWeatherCycle(42, 'storm');
    expect(c.current).toBe('storm');
    expect(c.pinned).toBe(true);
    expect(c.history).toEqual(['storm']);
  });

  it('an unpinned cycle is unchanged: pinned undefined', () => {
    const c = createWeatherCycle(42);
    expect(c.pinned).toBeUndefined();
    expect(c.current).toBe('sunny');
  });

  it('tickWeather holds the pinned state for 5000 ticks without growing history or moving the rng', () => {
    const c = createWeatherCycle(42, 'sunny');
    const rngBefore = c.rngState;
    for (let i = 0; i < 5000; i++) {
      expect(tickWeather(c)).toBe('sunny');
    }
    expect(c.current).toBe('sunny');
    expect(c.history).toHaveLength(1);
    expect(c.rngState).toBe(rngBefore);
    expect(c.pinned).toBe(true);
  });

  it('forecast of a pinned cycle is 14 sunny days and leaves the cycle untouched', () => {
    const c = createWeatherCycle(42, 'sunny');
    const snapshot = JSON.parse(JSON.stringify(c));
    expect(forecast(c, 14)).toEqual(Array(14).fill('sunny'));
    expect(c).toEqual(snapshot);
  });

  it('an unpinned forecast still varies over a long horizon', () => {
    expect(new Set(forecast(createWeatherCycle(42), 60)).size).toBeGreaterThan(1);
  });

  it('setWeather on a pinned cycle re-pins to the new state for tick and forecast', () => {
    const c = createWeatherCycle(42, 'sunny');
    setWeather(c, 'storm');
    for (let i = 0; i < 500; i++) tickWeather(c);
    expect(c.current).toBe('storm');
    expect(forecast(c, 7)).toEqual(Array(7).fill('storm'));
  });

  it('survives a JSON round trip', () => {
    const c = createWeatherCycle(42, 'sunny');
    const copy = JSON.parse(JSON.stringify(c));
    expect(copy.pinned).toBe(true);
    for (let i = 0; i < 300; i++) tickWeather(copy);
    expect(copy.current).toBe('sunny');
  });
});
