// BlastSimulator2026 — new_game / sandbox start / campaign start reset the
// weather cycle (#1459). Since #1403 the cycle lives in GameState.weather, so
// every game start gets a fresh one from createGame — no separate ctx reset.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { createWeatherCycle, tickWeather } from '../../src/core/weather/WeatherCycle.js';

describe('weather reset on game start (#1459, #1403)', () => {
  it('new_game seed:42 -> heavy_rain -> new_game seed:42 returns to createWeatherCycle(42)', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    runner.run('weather set heavy_rain');
    expect(ctx.state!.weather.current).toBe('heavy_rain');
    expect(runner.run('new_game seed:42').success).toBe(true);
    expect(ctx.state!.weather).toEqual(createWeatherCycle(42));
  });

  it('a different seed uses the new seed', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    runner.run('weather set storm');
    runner.run('new_game seed:7');
    expect(ctx.state!.weather).toEqual(createWeatherCycle(7));
  });

  it('first new_game defines a sunny cycle', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    expect(ctx.state!.weather.current).toBe('sunny');
    expect(ctx.state!.weather.history).toEqual(['sunny']);
  });

  it('PRNG is reset: ticking after a reset matches a fresh game', () => {
    const fresh = createRunner();
    fresh.runner.run('new_game seed:42');
    const used = createRunner();
    used.runner.run('new_game seed:42');
    used.runner.run('tick 200');
    used.runner.run('new_game seed:42');

    const expected = createWeatherCycle(42);
    for (let i = 0; i < 200; i++) tickWeather(expected);
    fresh.runner.run('tick 200');
    used.runner.run('tick 200');
    expect(used.ctx.state!.weather).toEqual(expected);
    expect(fresh.ctx.state!.weather).toEqual(expected);
  });

  it('sandbox start resets weather with its seed', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    runner.run('weather set heavy_rain');
    expect(runner.run('sandbox start seed:5').success).toBe(true);
    expect(ctx.state!.weather).toEqual(createWeatherCycle(5));
  });

  it('campaign start resets weather with the new state seed', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    runner.run('weather set heavy_rain');
    // dusty_hollow: unpinned, so its cycle derives from the new state seed.
    expect(runner.run('campaign start level:dusty_hollow').success).toBe(true);
    expect(ctx.state!.weather).toEqual(createWeatherCycle(ctx.state!.seed));
  });

  it('campaign start on the tutorial pins the weather to sunny (#1585)', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    runner.run('weather set heavy_rain');
    expect(runner.run('campaign start level:tutorial_pit').success).toBe(true);
    expect(ctx.state!.weather).toEqual(createWeatherCycle(ctx.state!.seed, 'sunny'));
    runner.run('tick 300');
    expect(ctx.state!.weather.current).toBe('sunny');
  });

  it('failed new_game leaves weather untouched', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    runner.run('weather set heavy_rain');
    const before = structuredClone(ctx.state!.weather);
    expect(runner.run('new_game seed:42 staffed:maybe').success).toBe(false);
    expect(ctx.state!.weather).toEqual(before);
  });
});
