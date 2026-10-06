// BlastSimulator2026 — Weather advances inside the tick pipeline (#1403)
//
// state.weather is ticked once per runTick, persisted with the save, feeds the
// event context, and agrees with the TopBar's forecast() lookahead no matter
// how the ticks were batched.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { createGame, SAVE_VERSION, type GameState } from '../../src/core/state/GameState.js';
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';
import { runTick } from '../../src/core/engine/TickPipeline.js';
import { buildTickEventContext } from '../../src/core/engine/TickEventContext.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { Random } from '../../src/core/math/Random.js';
import { clearPendingEvent } from '../../src/core/events/EventSystem.js';
import { getEventById } from '../../src/core/events/EventPool.js';
import { WEATHER_HISTORY_MAX } from '../../src/core/config/balance.js';
import {
  ALL_WEATHER_STATES,
  createWeatherCycle,
  forecast,
} from '../../src/core/weather/WeatherCycle.js';

const SEED = 42;

/** Advance `state` by one tick through the real pipeline, with the same rng recipe as the console `tick` command. */
function step(state: GameState, emitter = new EventEmitter()): void {
  runTick(state, null, new Random(state.seed + state.tickCount), emitter, { checkInvariants: false });
}

function quietGame(seed = SEED): GameState {
  const state = createGame({ seed });
  state.events.eventFreqMultiplier = 0; // pending events would halt console `tick`; weather is what is under test
  return state;
}

describe('runTick advances state.weather (#1403)', () => {
  it('ticks the weather exactly once per runTick', () => {
    const state = quietGame();
    const expected = structuredClone(state.weather);
    expect(expected.ticksRemaining).toBeGreaterThan(1);
    step(state);
    expect(state.weather.ticksRemaining).toBe(expected.ticksRemaining - 1);
    step(state);
    expect(state.weather.ticksRemaining).toBe(expected.ticksRemaining - 2);
  });

  it('leaves sunny on some day within 7 days of ticks', () => {
    const state = quietGame();
    let sawOther = false;
    for (let day = 0; day < 7; day++) {
      for (let i = 0; i < 24; i++) step(state);
      if (state.weather.current !== 'sunny') sawOther = true;
    }
    expect(sawOther).toBe(true);
  });

  it('same seed gives the same weather history; different seed differs', () => {
    const run = (seed: number) => {
      const s = quietGame(seed);
      for (let i = 0; i < 400; i++) step(s);
      return s.weather.history.join(',');
    };
    expect(run(42)).toBe(run(42));
    expect(run(42)).not.toBe(run(43));
  });

  it('keeps history bounded over a long run', () => {
    const state = quietGame();
    for (let i = 0; i < 3000; i++) step(state);
    expect(state.weather.history.length).toBeLessThanOrEqual(WEATHER_HISTORY_MAX);
    expect(ALL_WEATHER_STATES).toContain(state.weather.current);
  });
});

describe('forecast agrees with the live cycle (#1403)', () => {
  it.each(Array.from({ length: 14 }, (_, i) => i + 1))(
    'forecast(weather)[%i - 1] equals weather.current after that many days of runTick',
    (n) => {
      const state = quietGame();
      const predicted = forecast(state.weather, n);
      for (let i = 0; i < n * 24; i++) step(state);
      expect(predicted[n - 1]).toBe(state.weather.current);
    },
  );

  it('forecast does not mutate state.weather', () => {
    const state = quietGame();
    for (let i = 0; i < 30; i++) step(state);
    const before = structuredClone(state.weather);
    forecast(state.weather, 14);
    expect(state.weather).toEqual(before);
  });

  it('holds through the console tick command with mixed batch sizes', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    ctx.state!.events.eventFreqMultiplier = 0;
    const predicted = forecast(ctx.state!.weather, 14);
    const batches = [[5, 19], [24], [1, 1, 22], [10, 14]];
    for (let day = 1; day <= 14; day++) {
      for (const size of batches[day % batches.length]!) {
        expect(runner.run(`tick ${size}`).success).toBe(true);
      }
      expect(ctx.state!.tickCount).toBe(day * 24);
      expect(ctx.state!.weather.current).toBe(predicted[day - 1]);
    }
  });

  it('console tick and direct runTick produce identical weather', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    ctx.state!.events.eventFreqMultiplier = 0;
    runner.run('tick 100');
    const direct = quietGame();
    for (let i = 0; i < 100; i++) step(direct);
    expect(ctx.state!.weather).toEqual(direct.weather);
  });
});

describe('weather persists with the save (#1403)', () => {
  it('save/load mid-cycle then 48 ticks equals running on without saving', () => {
    const live = quietGame();
    for (let i = 0; i < 37; i++) step(live);
    const reloaded = deserialize(serialize(live));
    expect(reloaded.weather).toEqual(live.weather);
    for (let i = 0; i < 48; i++) {
      step(live);
      step(reloaded);
    }
    expect(reloaded.weather).toEqual(live.weather);
  });

  it('saves carry the current SAVE_VERSION', () => {
    expect(JSON.parse(serialize(createGame({ seed: SEED }))).version).toBe(SAVE_VERSION);
  });

  it('a v29 save without weather loads with a valid cycle at SAVE_VERSION', () => {
    const raw = JSON.parse(serialize(createGame({ seed: SEED }))) as Record<string, unknown>;
    delete raw['weather'];
    raw['version'] = 29;
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(ALL_WEATHER_STATES).toContain(loaded.weather.current);
    expect(loaded.weather.ticksRemaining).toBeGreaterThan(0);
    expect(Number.isFinite(loaded.weather.rngState)).toBe(true);
    expect(loaded.weather.history.length).toBeGreaterThan(0);
    expect(loaded.weather).toEqual(createWeatherCycle(SEED));
  });

  it('a v29 save keeps ticking weather after load', () => {
    const raw = JSON.parse(serialize(quietGame())) as Record<string, unknown>;
    delete raw['weather'];
    raw['version'] = 29;
    const loaded = deserialize(JSON.stringify(raw));
    const before = loaded.weather.ticksRemaining;
    step(loaded);
    expect(loaded.weather.ticksRemaining).not.toBe(before);
  });

  it('malformed weather (unknown state) falls back to a fresh cycle', () => {
    const raw = JSON.parse(serialize(createGame({ seed: SEED }))) as Record<string, unknown>;
    raw['weather'] = { current: 'tornado', ticksRemaining: 5, history: ['tornado'], rngState: 1 };
    const loaded = deserialize(JSON.stringify(raw));
    expect(ALL_WEATHER_STATES).toContain(loaded.weather.current);
    expect(loaded.weather).toEqual(createWeatherCycle(SEED));
  });

  it('malformed weather (wrong field types) falls back to a fresh cycle', () => {
    const raw = JSON.parse(serialize(createGame({ seed: SEED }))) as Record<string, unknown>;
    raw['weather'] = { current: 'storm', ticksRemaining: 'soon', history: 'x' };
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.weather).toEqual(createWeatherCycle(SEED));
  });

  it('console save/load round-trips weather', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    ctx.state!.events.eventFreqMultiplier = 0;
    runner.run('tick 30');
    runner.run('save slot:w');
    const saved = structuredClone(ctx.state!.weather);
    runner.run('tick 50');
    expect(runner.run('load slot:w').success).toBe(true);
    expect(ctx.state!.weather).toEqual(saved);
  });
});

describe('weather feeds events (#1403)', () => {
  it('event context reports the live weather after ticking', () => {
    const state = quietGame();
    for (let i = 0; i < 100; i++) {
      step(state);
      expect(buildTickEventContext(state).weatherId).toBe(state.weather.current);
    }
  });

  it('a storm-gated event can fire once weather is storm', () => {
    const state = createGame({ seed: SEED });
    let found: string | null = null;
    for (let i = 0; i < 6000 && !found; i++) {
      state.weather.current = 'storm';
      state.weather.ticksRemaining = 50; // hold the storm for the whole run
      state.events.actionCountSinceEvent = 100; // no player here; satisfy the action cooldown gate
      const report = runTick(state, null, new Random(state.seed + state.tickCount), new EventEmitter(), { checkInvariants: false });
      if (report.firedEvent) {
        const def = getEventById(report.firedEvent.eventId);
        const ctx = buildTickEventContext(state);
        if (def && def.canFire({ ...ctx, weatherId: 'storm' }) && !def.canFire({ ...ctx, weatherId: 'sunny' })) {
          found = def.id;
        }
        clearPendingEvent(state.events);
      }
    }
    expect(found).not.toBeNull();
  });
});
