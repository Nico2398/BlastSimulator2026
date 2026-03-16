import { describe, it, expect, vi } from 'vitest';
import {
  createArrestState,
  updateArrest,
  ARREST_EXPOSURE_THRESHOLD,
} from '../../../src/core/campaign/CriminalArrest.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';

describe('Criminal arrest system (7.5)', () => {
  it('exposure level above threshold triggers arrest', () => {
    const state = createGame({ seed: 1 });
    state.mafia.exposureRisk = ARREST_EXPOSURE_THRESHOLD;
    const arrest = createArrestState();
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('arrest:triggered', handler);

    const triggered = updateArrest(state, arrest, emitter);

    expect(triggered).toBe(true);
    expect(arrest.arrested).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ exposure: ARREST_EXPOSURE_THRESHOLD });
  });

  it('exposure below threshold does not trigger arrest', () => {
    const state = createGame({ seed: 1 });
    state.mafia.exposureRisk = ARREST_EXPOSURE_THRESHOLD - 0.01;
    const arrest = createArrestState();
    const emitter = new EventEmitter();

    const triggered = updateArrest(state, arrest, emitter);

    expect(triggered).toBe(false);
    expect(arrest.arrested).toBe(false);
  });

  it('arrest ends the current level (not the campaign)', () => {
    const state = createGame({ seed: 1 });
    state.mafia.exposureRisk = 1.0;
    const arrest = createArrestState();
    const emitter = new EventEmitter();

    updateArrest(state, arrest, emitter);
    expect(arrest.arrested).toBe(true);

    // Campaign state still has levels
    expect(Object.keys(state.campaign.levels).length).toBeGreaterThan(0);
  });

  it('arrest does not re-fire after triggered', () => {
    const state = createGame({ seed: 1 });
    state.mafia.exposureRisk = 1.0;
    const arrest = createArrestState();
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('arrest:triggered', handler);

    updateArrest(state, arrest, emitter);
    updateArrest(state, arrest, emitter);
    updateArrest(state, arrest, emitter);

    expect(handler).toHaveBeenCalledOnce();
  });
});
