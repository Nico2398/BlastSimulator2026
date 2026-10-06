// BlastSimulator2026 — TutorialProgress state helpers + save round-trip (#1333)
import { describe, it, expect } from 'vitest';
import { createGame, SAVE_VERSION } from '../../../src/core/state/GameState.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import {
  recordTutorialProgress,
  clearTutorialProgress,
  readTutorialProgress,
  sanitizeTutorialProgress,
} from '../../../src/core/state/TutorialProgress.js';

describe('recordTutorialProgress / clearTutorialProgress', () => {
  it('records step index and snapshot on the state', () => {
    const state = createGame({ seed: 42 });
    recordTutorialProgress(state, 3, { employeeCount: 2 });
    expect(state.tutorialProgress).toEqual({ stepIndex: 3, snapshot: { employeeCount: 2 } });
  });

  it('overwrites earlier progress', () => {
    const state = createGame({ seed: 42 });
    recordTutorialProgress(state, 1, { a: 1 });
    recordTutorialProgress(state, 2, { b: 2 });
    expect(state.tutorialProgress).toEqual({ stepIndex: 2, snapshot: { b: 2 } });
  });

  it('accepts step index 0 and an empty snapshot', () => {
    const state = createGame({ seed: 42 });
    recordTutorialProgress(state, 0, {});
    expect(state.tutorialProgress).toEqual({ stepIndex: 0, snapshot: {} });
  });

  it('clear removes progress', () => {
    const state = createGame({ seed: 42 });
    recordTutorialProgress(state, 4, {});
    clearTutorialProgress(state);
    expect(state.tutorialProgress == null).toBe(true);
  });

  it('clear on a state without progress is a no-op', () => {
    const state = createGame({ seed: 42 });
    expect(() => clearTutorialProgress(state)).not.toThrow();
    expect(state.tutorialProgress == null).toBe(true);
  });
});

describe('readTutorialProgress', () => {
  it('returns recorded progress inside range', () => {
    expect(readTutorialProgress({ tutorialProgress: { stepIndex: 2, snapshot: { x: 1 } } }, 10))
      .toEqual({ stepIndex: 2, snapshot: { x: 1 } });
  });

  it('returns progress at the last valid index', () => {
    expect(readTutorialProgress({ tutorialProgress: { stepIndex: 9, snapshot: {} } }, 10)?.stepIndex).toBe(9);
  });

  it('returns null when absent', () => {
    expect(readTutorialProgress({}, 10)).toBeNull();
  });

  it('returns null when stepIndex equals stepCount', () => {
    expect(readTutorialProgress({ tutorialProgress: { stepIndex: 10, snapshot: {} } }, 10)).toBeNull();
  });

  it('returns null when stepIndex exceeds stepCount', () => {
    expect(readTutorialProgress({ tutorialProgress: { stepIndex: 99, snapshot: {} } }, 10)).toBeNull();
  });
});

describe('sanitizeTutorialProgress', () => {
  it('keeps well-formed input', () => {
    expect(sanitizeTutorialProgress({ stepIndex: 5, snapshot: { a: 1 } })).toEqual({ stepIndex: 5, snapshot: { a: 1 } });
  });

  it('keeps index 0', () => {
    expect(sanitizeTutorialProgress({ stepIndex: 0, snapshot: {} })).toEqual({ stepIndex: 0, snapshot: {} });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['string', 'nope'],
    ['number', 3],
    ['array', []],
    ['missing index', { snapshot: {} }],
    ['string index', { stepIndex: '2', snapshot: {} }],
    ['negative index', { stepIndex: -1, snapshot: {} }],
    ['fractional index', { stepIndex: 1.5, snapshot: {} }],
    ['NaN index', { stepIndex: NaN, snapshot: {} }],
    ['null snapshot', { stepIndex: 1, snapshot: null }],
    ['missing snapshot', { stepIndex: 1 }],
    ['string snapshot', { stepIndex: 1, snapshot: 'x' }],
  ])('returns undefined for malformed: %s', (_label, raw) => {
    expect(sanitizeTutorialProgress(raw)).toBeUndefined();
  });
});

describe('tutorialProgress save round-trip', () => {
  it('roundtrips through serialize/deserialize', () => {
    const state = createGame({ seed: 42 });
    recordTutorialProgress(state, 6, { employeeCount: 3, nested: { k: [1, 2] } });
    const loaded = deserialize(serialize(state));
    expect(loaded.tutorialProgress).toEqual({ stepIndex: 6, snapshot: { employeeCount: 3, nested: { k: [1, 2] } } });
    expect(loaded.version).toBe(SAVE_VERSION);
  });

  it('a save without the field loads undefined at the current version', () => {
    const state = createGame({ seed: 42 });
    const obj = JSON.parse(serialize(state)) as Record<string, unknown>;
    delete obj['tutorialProgress'];
    const loaded = deserialize(JSON.stringify(obj));
    expect(loaded.tutorialProgress).toBeUndefined();
    expect(loaded.version).toBe(SAVE_VERSION);
  });

  it.each([
    ['string', 'garbage'],
    ['negative index', { stepIndex: -2, snapshot: {} }],
    ['fractional index', { stepIndex: 0.5, snapshot: {} }],
    ['null snapshot', { stepIndex: 1, snapshot: null }],
  ])('malformed saved progress (%s) loads as undefined', (_label, bad) => {
    const state = createGame({ seed: 42 });
    const obj = JSON.parse(serialize(state)) as Record<string, unknown>;
    obj['tutorialProgress'] = bad;
    expect(deserialize(JSON.stringify(obj)).tutorialProgress).toBeUndefined();
  });
});
