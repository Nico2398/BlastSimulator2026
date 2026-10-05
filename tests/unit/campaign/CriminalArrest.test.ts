import { describe, it, expect, vi } from 'vitest';
import {
  createArrestState,
  updateArrest,
  ARREST_EXPOSURE_THRESHOLD,
  ARREST_WARNING_EXPOSURE,
  type ArrestState,
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

describe('Arrest exposure warning (#1415)', () => {
  function setup(exposure: number) {
    const state = createGame({ seed: 1 });
    state.mafia.exposureRisk = exposure;
    const emitter = new EventEmitter();
    const warning = vi.fn();
    const triggered = vi.fn();
    emitter.on('arrest:warning', warning);
    emitter.on('arrest:triggered', triggered);
    return { state, emitter, warning, triggered };
  }

  it('createArrestState starts with warningFired false', () => {
    expect(createArrestState().warningFired).toBe(false);
  });

  it('emits arrest:warning once when exposure reaches the warning level, without arresting', () => {
    const { state, emitter, warning, triggered } = setup(0.8);
    const arrest = createArrestState();
    const result = updateArrest(state, arrest, emitter);
    expect(result).toBe(false);
    expect(arrest.arrested).toBe(false);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith({ exposure: 0.8 });
    expect(triggered).not.toHaveBeenCalled();
  });

  it('emits at exactly the warning exposure', () => {
    const { state, emitter, warning } = setup(ARREST_WARNING_EXPOSURE);
    updateArrest(state, createArrestState(), emitter);
    expect(warning).toHaveBeenCalledOnce();
  });

  it('emits nothing just below the warning exposure', () => {
    const { state, emitter, warning } = setup(0.74);
    updateArrest(state, createArrestState(), emitter);
    expect(warning).not.toHaveBeenCalled();
  });

  it('does not repeat while exposure stays at or above the warning level', () => {
    const { state, emitter, warning } = setup(0.8);
    const arrest = createArrestState();
    updateArrest(state, arrest, emitter);
    updateArrest(state, arrest, emitter);
    state.mafia.exposureRisk = 0.85;
    updateArrest(state, arrest, emitter);
    expect(warning).toHaveBeenCalledOnce();
  });

  it('re-fires after exposure drops below the warning level and rises again', () => {
    const { state, emitter, warning } = setup(0.8);
    const arrest = createArrestState();
    updateArrest(state, arrest, emitter);
    state.mafia.exposureRisk = 0.5;
    updateArrest(state, arrest, emitter);
    expect(arrest.warningFired).toBe(false);
    state.mafia.exposureRisk = 0.8;
    updateArrest(state, arrest, emitter);
    expect(warning).toHaveBeenCalledTimes(2);
  });

  it('a jump past the arrest threshold emits arrest:triggered and no warning', () => {
    const { state, emitter, warning, triggered } = setup(0.5);
    const arrest = createArrestState();
    updateArrest(state, arrest, emitter);
    state.mafia.exposureRisk = 0.95;
    updateArrest(state, arrest, emitter);
    expect(triggered).toHaveBeenCalledOnce();
    expect(warning).not.toHaveBeenCalled();
  });

  it('emits no warning once already arrested', () => {
    const { state, emitter, warning } = setup(0.8);
    const arrest: ArrestState = { arrested: true, warningFired: false };
    updateArrest(state, arrest, emitter);
    expect(warning).not.toHaveBeenCalled();
  });

  it('treats a state object lacking warningFired as not yet warned', () => {
    const { state, emitter, warning } = setup(0.8);
    const arrest = { arrested: false } as unknown as ArrestState;
    updateArrest(state, arrest, emitter);
    expect(warning).toHaveBeenCalledOnce();
  });
});
