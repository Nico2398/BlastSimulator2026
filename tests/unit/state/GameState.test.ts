import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { tick } from '../../../src/core/state/GameLoop.js';

describe('createGame', () => {
  it('returns a valid GameState with default fields', () => {
    const state = createGame({ seed: 42 });
    expect(state.seed).toBe(42);
    expect(state.time).toBe(0);
    expect(state.timeScale).toBe(1);
    expect(state.isPaused).toBe(false);
    expect(state.version).toBeDefined();
  });

  it('uses provided config values', () => {
    const state = createGame({ seed: 99 });
    expect(state.seed).toBe(99);
  });
});

describe('tick', () => {
  it('advances time by dt * timeScale', () => {
    const state = createGame({ seed: 42 });
    tick(state, 100);
    expect(state.time).toBe(100);
  });

  it('does not advance time when paused', () => {
    const state = createGame({ seed: 42 });
    state.isPaused = true;
    tick(state, 100);
    expect(state.time).toBe(0);
  });

  it('changing timeScale to 4 makes time advance 4x faster', () => {
    const state = createGame({ seed: 42 });
    state.timeScale = 4;
    tick(state, 100);
    expect(state.time).toBe(400);
  });

  it('increments tickCount each tick', () => {
    const state = createGame({ seed: 42 });
    tick(state, 50);
    tick(state, 50);
    expect(state.tickCount).toBe(2);
  });

  it('does not increment tickCount when paused', () => {
    const state = createGame({ seed: 42 });
    state.isPaused = true;
    tick(state, 50);
    expect(state.tickCount).toBe(0);
  });
});
