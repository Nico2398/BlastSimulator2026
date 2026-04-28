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
  PROFICIENCY_MULTIPLIERS,
  XP_THRESHOLDS,
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

// ─── Task 3.2: Proficiency multipliers & XP thresholds ────────────────────────

describe('Proficiency & XP balance (3.2)', () => {
  // ── PROFICIENCY_MULTIPLIERS ────────────────────────────────────────────────

  it('PROFICIENCY_MULTIPLIERS is exported from balance.ts', () => {
    expect(PROFICIENCY_MULTIPLIERS).toBeDefined();
  });

  it('PROFICIENCY_MULTIPLIERS[1] is 1.00 — Rookie baseline, no speed bonus', () => {
    expect((PROFICIENCY_MULTIPLIERS as Record<number, number>)[1]).toBe(1.00);
  });

  it('PROFICIENCY_MULTIPLIERS[2] is 0.85 — Competent reduces task duration by 15%', () => {
    expect((PROFICIENCY_MULTIPLIERS as Record<number, number>)[2]).toBe(0.85);
  });

  it('PROFICIENCY_MULTIPLIERS[3] is 0.70 — Skilled reduces task duration by 30%', () => {
    expect((PROFICIENCY_MULTIPLIERS as Record<number, number>)[3]).toBe(0.70);
  });

  it('PROFICIENCY_MULTIPLIERS[4] is 0.55 — Expert reduces task duration by 45%', () => {
    expect((PROFICIENCY_MULTIPLIERS as Record<number, number>)[4]).toBe(0.55);
  });

  it('PROFICIENCY_MULTIPLIERS[5] is 0.40 — Master reduces task duration by 60%', () => {
    expect((PROFICIENCY_MULTIPLIERS as Record<number, number>)[5]).toBe(0.40);
  });

  it('proficiency multipliers are strictly decreasing (higher level = faster tasks = lower multiplier)', () => {
    const mults = PROFICIENCY_MULTIPLIERS as Record<number, number>;
    expect(mults[1]).toBeGreaterThan(mults[2] as number);
    expect(mults[2]).toBeGreaterThan(mults[3] as number);
    expect(mults[3]).toBeGreaterThan(mults[4] as number);
    expect(mults[4]).toBeGreaterThan(mults[5] as number);
  });

  // ── XP_THRESHOLDS ──────────────────────────────────────────────────────────

  it('XP_THRESHOLDS is exported from balance.ts', () => {
    expect(XP_THRESHOLDS).toBeDefined();
  });

  it('XP_THRESHOLDS has exactly 5 entries — one per proficiency level', () => {
    expect(Object.keys(XP_THRESHOLDS as Record<number, number>).length).toBe(5);
  });

  it('XP_THRESHOLDS[1] is 0 — Rookie starts at zero XP', () => {
    expect((XP_THRESHOLDS as Record<number, number>)[1]).toBe(0);
  });

  it('XP_THRESHOLDS[2] is 100 — 100 cumulative XP to reach Competent', () => {
    expect((XP_THRESHOLDS as Record<number, number>)[2]).toBe(100);
  });

  it('XP_THRESHOLDS[3] is 300 — 300 cumulative XP to reach Skilled', () => {
    expect((XP_THRESHOLDS as Record<number, number>)[3]).toBe(300);
  });

  it('XP_THRESHOLDS[4] is 600 — 600 cumulative XP to reach Expert', () => {
    expect((XP_THRESHOLDS as Record<number, number>)[4]).toBe(600);
  });

  it('XP_THRESHOLDS[5] is 1000 — 1000 cumulative XP to reach Master', () => {
    expect((XP_THRESHOLDS as Record<number, number>)[5]).toBe(1000);
  });

  it('XP thresholds are strictly increasing (each level requires more cumulative XP than the previous)', () => {
    const thresholds = XP_THRESHOLDS as Record<number, number>;
    expect(thresholds[2]).toBeGreaterThan(thresholds[1] as number);
    expect(thresholds[3]).toBeGreaterThan(thresholds[2] as number);
    expect(thresholds[4]).toBeGreaterThan(thresholds[3] as number);
    expect(thresholds[5]).toBeGreaterThan(thresholds[4] as number);
  });
});
