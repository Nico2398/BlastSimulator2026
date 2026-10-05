import { describe, it, expect, vi } from 'vitest';
import {
  createRevoltState,
  revoltTicksRemaining,
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

  it('createRevoltState produces a state with no immune field (#681)', () => {
    const revolt = createRevoltState();
    expect(Object.keys(revolt)).not.toContain('immune');
    expect('immune' in revolt).toBe(false);
  });

  it('sustained 0 well-being triggers revolt regardless of any prior immunity flag (#681)', () => {
    const state = createGame({ seed: 1 });
    state.scores.wellBeing = 0;
    const revolt = createRevoltState();
    // Simulate a stale/foreign `immune` flag being present on the object —
    // updateRevolt must not special-case it since RevoltState no longer
    // declares the field at all.
    (revolt as unknown as Record<string, unknown>).immune = true;
    const emitter = new EventEmitter();

    let triggered = false;
    for (let i = 0; i < REVOLT_TICKS; i++) {
      triggered = updateRevolt(state, revolt, emitter) || triggered;
    }

    expect(triggered).toBe(true);
    expect(revolt.revolted).toBe(true);
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

describe('revoltTicksRemaining', () => {
  it('returns the full REVOLT_TICKS at zero ticks', () => {
    expect(revoltTicksRemaining(createRevoltState())).toBe(REVOLT_TICKS);
    expect(REVOLT_TICKS).toBe(120);
  });

  it('subtracts ticksAtZero', () => {
    const r = createRevoltState();
    r.ticksAtZero = 40;
    expect(revoltTicksRemaining(r)).toBe(REVOLT_TICKS - 40);
  });

  it('clamps at 0 at and beyond REVOLT_TICKS', () => {
    const r = createRevoltState();
    r.ticksAtZero = REVOLT_TICKS;
    expect(revoltTicksRemaining(r)).toBe(0);
    r.ticksAtZero = REVOLT_TICKS + 50;
    expect(revoltTicksRemaining(r)).toBe(0);
  });
});
