import { describe, it, expect, vi } from 'vitest';
import {
  createEcologicalState,
  updateEcology,
  ECOLOGICAL_SHUTDOWN_TICKS,
  ECOLOGICAL_WARNING_TICKS,
} from '../../../src/core/campaign/EcologicalDisaster.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';

describe('Ecological disaster system (7.6)', () => {
  it('sustained 0 ecology triggers shutdown', () => {
    const state = createGame({ seed: 1 });
    state.scores.ecology = 0;
    const eco = createEcologicalState();
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('ecology:shutdown', handler);

    let triggered = false;
    for (let i = 0; i < ECOLOGICAL_SHUTDOWN_TICKS; i++) {
      triggered = updateEcology(state, eco, emitter) || triggered;
    }

    expect(triggered).toBe(true);
    expect(eco.shutdown).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('recovering ecology in time prevents shutdown', () => {
    const state = createGame({ seed: 1 });
    state.scores.ecology = 0;
    const eco = createEcologicalState();
    const emitter = new EventEmitter();

    // Let ecology drop for half the grace period
    for (let i = 0; i < ECOLOGICAL_SHUTDOWN_TICKS / 2; i++) {
      updateEcology(state, eco, emitter);
    }
    expect(eco.shutdown).toBe(false);

    // Ecology recovers
    state.scores.ecology = 30;
    updateEcology(state, eco, emitter);
    expect(eco.ticksAtZero).toBe(0); // Counter reset

    // No shutdown even if we continue
    for (let i = 0; i < ECOLOGICAL_SHUTDOWN_TICKS; i++) {
      updateEcology(state, eco, emitter);
    }
    expect(eco.shutdown).toBe(false); // Ecology > 0, so no countdown
  });

  it('government warning fires at ECOLOGICAL_WARNING_TICKS', () => {
    const state = createGame({ seed: 1 });
    state.scores.ecology = 0;
    const eco = createEcologicalState();
    const emitter = new EventEmitter();
    const warnHandler = vi.fn();
    emitter.on('ecology:warning', warnHandler);

    for (let i = 0; i < ECOLOGICAL_WARNING_TICKS; i++) {
      updateEcology(state, eco, emitter);
    }
    expect(warnHandler).toHaveBeenCalledOnce();

    // Not repeated
    for (let i = 0; i < 10; i++) {
      updateEcology(state, eco, emitter);
    }
    expect(warnHandler).toHaveBeenCalledOnce();
  });
});
