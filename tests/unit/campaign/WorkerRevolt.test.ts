import { describe, it, expect, vi } from 'vitest';
import {
  createRevoltState,
  updateRevolt,
  REVOLT_TICKS,
  REVOLT_WARNING_TICKS,
} from '../../../src/core/campaign/WorkerRevolt.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';

describe('Worker revolt system (7.7)', () => {
  it('sustained 0 well-being triggers revolt', () => {
    const state = createGame({ seed: 1 });
    state.scores.wellBeing = 0;
    const revolt = createRevoltState();
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('revolt:triggered', handler);

    let triggered = false;
    for (let i = 0; i < REVOLT_TICKS; i++) {
      triggered = updateRevolt(state, revolt, emitter) || triggered;
    }

    expect(triggered).toBe(true);
    expect(revolt.revolted).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('recovering well-being prevents revolt', () => {
    const state = createGame({ seed: 1 });
    state.scores.wellBeing = 0;
    const revolt = createRevoltState();
    const emitter = new EventEmitter();

    for (let i = 0; i < REVOLT_TICKS / 2; i++) {
      updateRevolt(state, revolt, emitter);
    }
    expect(revolt.revolted).toBe(false);

    // Well-being recovers
    state.scores.wellBeing = 20;
    updateRevolt(state, revolt, emitter);
    expect(revolt.ticksAtZero).toBe(0);

    for (let i = 0; i < REVOLT_TICKS; i++) {
      updateRevolt(state, revolt, emitter);
    }
    expect(revolt.revolted).toBe(false); // wellBeing > 0, no countdown
  });

  it('strike warning fires at REVOLT_WARNING_TICKS', () => {
    const state = createGame({ seed: 1 });
    state.scores.wellBeing = 0;
    const revolt = createRevoltState();
    const emitter = new EventEmitter();
    const warnHandler = vi.fn();
    emitter.on('revolt:warning', warnHandler);

    for (let i = 0; i < REVOLT_WARNING_TICKS; i++) {
      updateRevolt(state, revolt, emitter);
    }
    expect(warnHandler).toHaveBeenCalledOnce();

    // Not repeated
    for (let i = 0; i < 10; i++) {
      updateRevolt(state, revolt, emitter);
    }
    expect(warnHandler).toHaveBeenCalledOnce();
  });
});
