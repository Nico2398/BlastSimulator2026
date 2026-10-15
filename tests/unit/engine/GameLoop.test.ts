// BlastSimulator2026 — Tests for GameLoop speed/pause controls
//
// processFrame's own tests (tick-batching by timeScale, pause short-circuit,
// auto-pause on a fired event) are retired along with processFrame itself
// (#1086 — the per-tick orchestration it wrapped moved to
// TickPipeline.runTick, tested in TickPipeline.test.ts). The auto-pause
// coverage lives on there as "sets firedEvent and paused=true when a
// timer-driven event fires this tick". setSpeed/pause/resume/isValidSpeed are
// untouched by the move and keep their coverage here.

import { describe, it, expect, beforeEach } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import {
  setSpeed,
  pause,
  resume,
  isValidSpeed,
  selectSpeed,
} from '../../../src/core/engine/GameLoop.js';
import { clearEvents } from '../../../src/core/events/EventPool.js';

describe('GameLoop', () => {
  let state: GameState;

  beforeEach(() => {
    clearEvents();
    state = createGame({ seed: 42 });
  });

  it('setSpeed validates input', () => {
    expect(setSpeed(state, 4)).toBe(true);
    expect(state.timeScale).toBe(4);

    expect(setSpeed(state, 3)).toBe(false);
    expect(state.timeScale).toBe(4); // unchanged
  });

  it('pause and resume work', () => {
    expect(state.isPaused).toBe(false);
    pause(state);
    expect(state.isPaused).toBe(true);
    resume(state);
    expect(state.isPaused).toBe(false);
  });

  describe('selectSpeed (#1751)', () => {
    it('sets the speed and resumes a paused game', () => {
      pause(state);
      expect(selectSpeed(state, 2)).toBe(true);
      expect(state.timeScale).toBe(2);
      expect(state.isPaused).toBe(false);
    });

    it('keeps a running game running at the new speed', () => {
      expect(selectSpeed(state, 8)).toBe(true);
      expect(state.timeScale).toBe(8);
      expect(state.isPaused).toBe(false);
    });

    it('accepts every valid speed', () => {
      for (const speed of [1, 2, 4, 8]) {
        pause(state);
        expect(selectSpeed(state, speed)).toBe(true);
        expect(state.timeScale).toBe(speed);
        expect(state.isPaused).toBe(false);
      }
    });

    it('rejects an invalid speed and leaves a paused game untouched', () => {
      setSpeed(state, 4);
      pause(state);
      expect(selectSpeed(state, 3)).toBe(false);
      expect(state.timeScale).toBe(4);
      expect(state.isPaused).toBe(true);
    });

    it('rejects zero', () => {
      pause(state);
      expect(selectSpeed(state, 0)).toBe(false);
      expect(state.isPaused).toBe(true);
    });
  });

  it('isValidSpeed identifies correct values', () => {
    expect(isValidSpeed(1)).toBe(true);
    expect(isValidSpeed(2)).toBe(true);
    expect(isValidSpeed(4)).toBe(true);
    expect(isValidSpeed(8)).toBe(true);
    expect(isValidSpeed(3)).toBe(false);
    expect(isValidSpeed(0)).toBe(false);
    expect(isValidSpeed(16)).toBe(false);
  });
});
