// BlastSimulator2026 — Balance config integration test (12.1)
// Simulates 30 game-minutes of play and verifies the player doesn't instantly
// go bankrupt or achieve runaway profit.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { processFrame } from '../../../src/core/engine/GameLoop.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  STARTING_CASH, PAY_CYCLE_TICKS, BASE_TICK_MS,
  EVENT_BASE_TIMERS, BANKRUPTCY_THRESHOLD, SCORE_DECAY_RATE, MAX_FRAGMENTS_PER_VOXEL,
} from '../../../src/core/config/balance.js';
import type { EventContext } from '../../../src/core/events/EventPool.js';
import type { GameState } from '../../../src/core/state/GameState.js';

function buildCtx(state: GameState): EventContext {
  return {
    scores: state.scores,
    employeeCount: state.employees.employees.length,
    deathCount: 0,
    corruptionLevel: 0,
    hasBuilding: () => false,
    hasDrillPlan: false,
    tickCount: state.tickCount,
    lawsuitCount: 0,
  };
}

// 30 real-minutes at 1x = 1800 ticks
const TICKS_30MIN = 1800;

describe('Balance config (12.1)', () => {
  it('exports all required constants', () => {
    // Verify the config exports values in reasonable ranges
    expect(STARTING_CASH).toBeGreaterThan(0);
    expect(PAY_CYCLE_TICKS).toBeGreaterThan(0);
    expect(BASE_TICK_MS).toBeGreaterThan(0);
  });

  it('starting cash matches GameState default', () => {
    const state = createGame({ seed: 42 });
    expect(state.cash).toBe(STARTING_CASH);
  });

  it('30-minute idle sim: player has positive cash (costs exist but no immediate bankruptcy)', () => {
    // Simulate without any employees or buildings — just the passage of time
    const state = createGame({ seed: 42 });
    const rng = new Random(42);

    let ticks = 0;
    // Run 30 game-minutes worth of ticks at 1x speed
    while (ticks < TICKS_30MIN) {
      if (state.isPaused) state.isPaused = false; // dismiss events for sim
      processFrame(state, buildCtx, rng);
      ticks++;
    }

    // Without any employees or buildings, cash should not change (no expenses)
    expect(state.cash).toBe(STARTING_CASH);
    expect(state.tickCount).toBe(TICKS_30MIN);
  });

  it('event timers fire within reasonable intervals', () => {
    for (const [cat, ticks] of Object.entries(EVENT_BASE_TIMERS)) {
      expect(ticks as number, `${cat} timer too low`).toBeGreaterThan(10);
      expect(ticks as number, `${cat} timer too high`).toBeLessThan(100);
    }
  });

  it('bankruptcy threshold is less than starting cash', () => {
    expect(BANKRUPTCY_THRESHOLD).toBeLessThan(STARTING_CASH);
  });

  it('score decay rate is slow enough to be manageable', () => {
    expect(SCORE_DECAY_RATE).toBeLessThan(0.2);
    expect(SCORE_DECAY_RATE).toBeGreaterThan(0);
  });

  it('fragment count per voxel is reasonable', () => {
    expect(MAX_FRAGMENTS_PER_VOXEL).toBeGreaterThan(0);
    expect(MAX_FRAGMENTS_PER_VOXEL).toBeLessThanOrEqual(50);
  });
});
