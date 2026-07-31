// BlastSimulator2026 — weatherCommand unit tests (#408)
// Covers the `weather set <state>` branch, plus its sibling `advance` and
// bare-status branches for context (mirrors the pattern in
// mining-commands.test.ts).

import { describe, it, expect } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import { weatherCommand } from '../../../src/console/commands/mining.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { createTubingState } from '../../../src/core/mining/Tubing.js';
import { ALL_WEATHER_STATES } from '../../../src/core/weather/WeatherCycle.js';

function makeCtx(): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    softwareTier: 0,
    tubingState: createTubingState(),
    emitter: new EventEmitter(),
  };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32' });
  return ctx;
}

describe('weatherCommand', () => {
  it('requires a loaded game', () => {
    const ctx: MiningContext = {
      state: null, grid: null, softwareTier: 0,
      tubingState: createTubingState(), emitter: new EventEmitter(),
    };
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

  describe('"set" branch', () => {
    it('sets weather directly to the requested state', () => {
      const ctx = makeCtx();
      const result = weatherCommand(ctx, ['set', 'storm'], {});
      expect(result.success).toBe(true);
      expect(result.output).toBe('Weather: storm');
      expect(ctx.weatherCycle!.current).toBe('storm');
    });

    it('works for every valid weather state', () => {
      const ctx = makeCtx();
      for (const state of ALL_WEATHER_STATES) {
        const result = weatherCommand(ctx, ['set', state], {});
        expect(result.success).toBe(true);
        expect(ctx.weatherCycle!.current).toBe(state);
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

    it('lazily initializes the weather cycle on first use', () => {
      const ctx = makeCtx();
      expect(ctx.weatherCycle).toBeUndefined();
      weatherCommand(ctx, ['set', 'cloudy'], {});
      expect(ctx.weatherCycle).toBeDefined();
    });
  });
});
