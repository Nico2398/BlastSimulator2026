// BlastSimulator2026 — new_game / sandbox start / campaign start reset the
// weather cycle and its PRNG (#1459). Without it, weather leaks across
// scenarios that share one engine (the batch runner's shared ctx).

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { resetWeatherForNewGame } from '../../src/console/commands/world.js';
import type { GameContext } from '../../src/console/commands/world.js';
import { createWeatherCycle, advanceWeather } from '../../src/core/weather/WeatherCycle.js';
import { Random } from '../../src/core/math/Random.js';

describe('weather reset on game start (#1459)', () => {
  it('new_game seed:42 -> heavy_rain -> new_game seed:42 returns to createWeatherCycle(42)', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    runner.run('weather set heavy_rain');
    expect(ctx.weatherCycle?.current).toBe('heavy_rain');
    expect(runner.run('new_game seed:42').success).toBe(true);
    expect(ctx.weatherCycle).toEqual(createWeatherCycle(42));
  });

  it('a different seed uses the new seed', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    runner.run('weather set storm');
    runner.run('new_game seed:7');
    expect(ctx.weatherCycle).toEqual(createWeatherCycle(7));
  });

  it('first new_game in a fresh ctx defines a sunny cycle', () => {
    const { runner, ctx } = createRunner();
    expect(ctx.weatherCycle).toBeUndefined();
    runner.run('new_game seed:42');
    expect(ctx.weatherCycle?.current).toBe('sunny');
    expect(ctx.weatherCycle?.history).toEqual(['sunny']);
    expect(ctx.rng).toBeInstanceOf(Random);
  });

  it('rng is reset: weather advanced after a reset matches a fresh game', () => {
    const fresh = createRunner();
    fresh.runner.run('new_game seed:42');
    const used = createRunner();
    used.runner.run('new_game seed:42');
    for (let i = 0; i < 40; i++) advanceWeather(used.ctx.weatherCycle!, used.ctx.rng!);
    used.runner.run('new_game seed:42');

    const expected = createWeatherCycle(42);
    const expectedRng = new Random(1042);
    for (let i = 0; i < 200; i++) {
      advanceWeather(expected, expectedRng);
      advanceWeather(used.ctx.weatherCycle!, used.ctx.rng!);
      advanceWeather(fresh.ctx.weatherCycle!, fresh.ctx.rng!);
    }
    expect(used.ctx.weatherCycle).toEqual(expected);
    expect(fresh.ctx.weatherCycle).toEqual(expected);
  });

  it('sandbox start resets weather with its seed', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    runner.run('weather set heavy_rain');
    expect(runner.run('sandbox start seed:5').success).toBe(true);
    expect(ctx.weatherCycle).toEqual(createWeatherCycle(5));
  });

  it('campaign start resets weather with the new state seed', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    runner.run('weather set heavy_rain');
    const res = runner.run('campaign start level:grumpstone_ridge');
    expect(res.success).toBe(true);
    expect(ctx.weatherCycle).toEqual(createWeatherCycle(ctx.state!.seed));
  });

  it('failed new_game leaves weather untouched', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    runner.run('weather set heavy_rain');
    const before = structuredClone(ctx.weatherCycle);
    const rng = ctx.rng;
    const res = runner.run('new_game seed:42 staffed:maybe');
    expect(res.success).toBe(false);
    expect(ctx.weatherCycle).toEqual(before);
    expect(ctx.rng).toBe(rng);
  });

  it('resetWeatherForNewGame sets cycle and a Random(seed + 1000)', () => {
    const target: Pick<GameContext, 'weatherCycle' | 'rng'> = {
      weatherCycle: { current: 'storm', ticksRemaining: 3, history: ['storm'] },
      rng: new Random(1),
    };
    resetWeatherForNewGame(target, 42);
    expect(target.weatherCycle).toEqual(createWeatherCycle(42));
    const expected = new Random(1042);
    expect(target.rng!.next()).toBe(expected.next());
    expect(target.rng!.next()).toBe(expected.next());
  });

  it('resetWeatherForNewGame defines both on an empty target', () => {
    const target: Pick<GameContext, 'weatherCycle' | 'rng'> = {};
    resetWeatherForNewGame(target, 0);
    expect(target.weatherCycle).toEqual(createWeatherCycle(0));
    expect(target.rng).toBeInstanceOf(Random);
  });
});
