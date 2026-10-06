// BlastSimulator2026 — weatherCommand unit tests (#408)
// Covers the `weather set <state>` branch, plus its sibling `advance` and
// bare-status branches for context (mirrors the pattern in
// mining-commands.test.ts).

import { describe, it, expect } from 'vitest';
import { weatherCommand } from '../../../src/console/commands/mining.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { ALL_WEATHER_STATES } from '../../../src/core/weather/WeatherCycle.js';
import { makeEmptyGameContext, makeGameContext } from '../../helpers/gameContext.js';

function makeCtx(): MiningContext {
  return makeGameContext({ mineType: 'desert', seed: 1, size: 32 });
}

describe('weatherCommand', () => {
  it('requires a loaded game', () => {
    const ctx = makeEmptyGameContext();
    const result = weatherCommand(ctx, [], {});
    expect(result.success).toBe(false);
  });

  it('bare command reports current weather without args', () => {
    const ctx = makeCtx();
    const result = weatherCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('Current weather:');
  });

  it('"advance" forces a state transition', () => {
    const ctx = makeCtx();
    const result = weatherCommand(ctx, ['advance'], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('Weather:');
  });

  it('"advance" mutates ctx.state.weather on its own persisted stream', () => {
    const ctx = makeCtx();
    const before = ctx.state!.weather.rngState;
    const result = weatherCommand(ctx, ['advance'], {});
    expect(result.output).toBe(`Weather: ${ctx.state!.weather.current}`);
    expect(ctx.state!.weather.rngState).not.toBe(before);
  });

  it('bare command reads ctx.state.weather', () => {
    const ctx = makeCtx();
    ctx.state!.weather.current = 'heat_wave';
    expect(weatherCommand(ctx, [], {}).output).toBe('Current weather: heat_wave');
  });

  describe('"set" branch', () => {
    it('sets weather directly to the requested state', () => {
      const ctx = makeCtx();
      const result = weatherCommand(ctx, ['set', 'storm'], {});
      expect(result.success).toBe(true);
      expect(result.output).toBe('Weather: storm');
      expect(ctx.state!.weather.current).toBe('storm');
    });

    it('works for every valid weather state', () => {
      const ctx = makeCtx();
      for (const state of ALL_WEATHER_STATES) {
        const result = weatherCommand(ctx, ['set', state], {});
        expect(result.success).toBe(true);
        expect(ctx.state!.weather.current).toBe(state);
      }
    });

    it('rejects a missing state argument with a usage message', () => {
      const ctx = makeCtx();
      const result = weatherCommand(ctx, ['set'], {});
      expect(result.success).toBe(false);
      expect(result.output).toContain('Usage: weather set');
    });

    it('rejects an unknown state with a usage message listing valid states', () => {
      const ctx = makeCtx();
      const result = weatherCommand(ctx, ['set', 'tornado'], {});
      expect(result.success).toBe(false);
      expect(result.output).toContain('Usage: weather set');
      expect(result.output).toContain('sunny');
    });

    it('writes through to ctx.state.weather (same object, no shadow cycle)', () => {
      const ctx = makeCtx();
      const weather = ctx.state!.weather;
      weatherCommand(ctx, ['set', 'cloudy'], {});
      expect(ctx.state!.weather).toBe(weather);
      expect(weather.current).toBe('cloudy');
      expect(weather.history[weather.history.length - 1]).toBe('cloudy');
    });
  });
});
