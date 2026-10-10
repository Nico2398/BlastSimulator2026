// Fixed-weather levels keep their pin through save/load (#1585).

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';
import { createGameForLevel } from '../../src/core/campaign/LevelTransition.js';
import { createCampaignState } from '../../src/core/campaign/Campaign.js';
import { Random } from '../../src/core/math/Random.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { runTick } from '../../src/core/engine/TickPipeline.js';
import { tickWeather } from '../../src/core/weather/WeatherCycle.js';

describe('weather pin save/load (#1585)', () => {
  it('a tutorial game round trip keeps the pin and stays sunny', () => {
    const state = createGameForLevel(createCampaignState(), 'tutorial_pit')!;
    const restored = deserialize(serialize(state));
    expect(restored.weather.pinned).toBe(true);
    expect(restored.weather.current).toBe('sunny');
    const emitter = new EventEmitter();
    for (let i = 0; i < 500; i++) {
      runTick(restored, null, new Random(restored.seed + restored.tickCount), emitter, { checkInvariants: false });
      expect(restored.weather.current).toBe('sunny');
    }
    expect(restored.weather.pinned).toBe(true);
  });

  it('a round trip after ticking keeps the pin', () => {
    const state = createGameForLevel(createCampaignState(), 'tutorial_pit')!;
    for (let i = 0; i < 100; i++) tickWeather(state.weather);
    const restored = deserialize(serialize(state));
    expect(restored.weather.pinned).toBe(true);
    for (let i = 0; i < 500; i++) tickWeather(restored.weather);
    expect(restored.weather.current).toBe('sunny');
  });

  it('an unpinned game round trip stays unpinned', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    const restored = deserialize(serialize(ctx.state!));
    expect(restored.weather.pinned).toBeUndefined();
  });

  it('weather set still overrides on a pinned tutorial game', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('campaign start level:tutorial_pit').success).toBe(true);
    expect(ctx.state!.weather.pinned).toBe(true);
    expect(runner.run('weather set heavy_rain').success).toBe(true);
    expect(ctx.state!.weather.current).toBe('heavy_rain');
    runner.run('tick 20');
    expect(ctx.state!.weather.current).toBe('heavy_rain');
  });
});
