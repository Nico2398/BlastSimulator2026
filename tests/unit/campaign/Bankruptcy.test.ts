import { describe, it, expect, vi } from 'vitest';
import {
  createBankruptcyState,
  updateBankruptcy,
  BANKRUPTCY_THRESHOLD,
  BANKRUPTCY_GRACE_TICKS,
  BANKRUPTCY_WARNING_TICKS,
} from '../../../src/core/campaign/Bankruptcy.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';

describe('Bankruptcy system (7.4)', () => {
  it('sustained negative balance triggers bankruptcy', () => {
    const state = createGame({ seed: 1 });
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    const bankruptcy = createBankruptcyState();
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('bankruptcy:triggered', handler);

    let triggered = false;
    for (let i = 0; i < BANKRUPTCY_GRACE_TICKS; i++) {
      triggered = updateBankruptcy(state, bankruptcy, emitter) || triggered;
    }

    expect(triggered).toBe(true);
    expect(bankruptcy.bankrupt).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('temporary negative balance followed by income does not trigger', () => {
    const state = createGame({ seed: 1 });
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    const bankruptcy = createBankruptcyState();
    const emitter = new EventEmitter();

    // Run for half the grace period
    for (let i = 0; i < BANKRUPTCY_GRACE_TICKS / 2; i++) {
      updateBankruptcy(state, bankruptcy, emitter);
    }
    expect(bankruptcy.bankrupt).toBe(false);

    // Cash recovers
    state.cash = BANKRUPTCY_THRESHOLD + 10000;
    updateBankruptcy(state, bankruptcy, emitter);
    expect(bankruptcy.ticksBelowThreshold).toBe(0);
    expect(bankruptcy.bankrupt).toBe(false);

    // Back to negative for full grace period — should eventually trigger
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    for (let i = 0; i < BANKRUPTCY_GRACE_TICKS; i++) {
      updateBankruptcy(state, bankruptcy, emitter);
    }
    expect(bankruptcy.bankrupt).toBe(true);
  });

  it('warning event fires when balance is low for BANKRUPTCY_WARNING_TICKS', () => {
    const state = createGame({ seed: 1 });
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    const bankruptcy = createBankruptcyState();
    const emitter = new EventEmitter();
    const warnHandler = vi.fn();
    emitter.on('bankruptcy:warning', warnHandler);

    for (let i = 0; i < BANKRUPTCY_WARNING_TICKS; i++) {
      updateBankruptcy(state, bankruptcy, emitter);
    }
    expect(warnHandler).toHaveBeenCalledOnce();

    // Warning is not repeated in same streak
    for (let i = 0; i < 10; i++) {
      updateBankruptcy(state, bankruptcy, emitter);
    }
    expect(warnHandler).toHaveBeenCalledOnce();
  });

  it('bankruptcy does not fire again after already triggered', () => {
    const state = createGame({ seed: 1 });
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    const bankruptcy = createBankruptcyState();
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('bankruptcy:triggered', handler);

    for (let i = 0; i < BANKRUPTCY_GRACE_TICKS * 2; i++) {
      updateBankruptcy(state, bankruptcy, emitter);
    }
    expect(handler).toHaveBeenCalledOnce(); // Only once
  });
});
