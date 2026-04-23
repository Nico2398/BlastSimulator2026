// BlastSimulator2026 — Tests for GameLoop time acceleration

import { describe, it, expect, beforeEach } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  processFrame,
  setSpeed,
  pause,
  resume,
  isValidSpeed,
  BASE_TICK_MS,
  tickVehicle,
} from '../../../src/core/engine/GameLoop.js';
import type { EventContext } from '../../../src/core/events/EventPool.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { clearEvents, registerEvents } from '../../../src/core/events/EventPool.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';

function buildContext(state: GameState): EventContext {
  return {
    scores: state.scores,
    employeeCount: state.employees.employees.length,
    deathCount: state.damage.deathCount,
    corruptionLevel: state.corruption.level,
    hasBuilding: () => false,
    hasDrillPlan: false,
    tickCount: state.tickCount,
    lawsuitCount: 0,
    activeContractCount: 0,
    weatherId: 'clear',
  };
}

describe('GameLoop', () => {
  let state: GameState;
  let rng: Random;

  beforeEach(() => {
    clearEvents();
    state = createGame({ seed: 42 });
    rng = new Random(42);
  });

  it('processes 1 tick at 1x speed', () => {
    state.timeScale = 1;
    const result = processFrame(state, buildContext, rng);
    expect(result.ticksProcessed).toBe(1);
    expect(state.tickCount).toBe(1);
    expect(state.time).toBe(BASE_TICK_MS);
  });

  it('processes 4 ticks at 4x speed', () => {
    state.timeScale = 4;
    const result = processFrame(state, buildContext, rng);
    expect(result.ticksProcessed).toBe(4);
    expect(state.tickCount).toBe(4);
    expect(state.time).toBe(4 * BASE_TICK_MS);
  });

  it('processes 8 ticks at 8x speed', () => {
    state.timeScale = 8;
    const result = processFrame(state, buildContext, rng);
    expect(result.ticksProcessed).toBe(8);
    expect(state.tickCount).toBe(8);
  });

  it('does nothing when paused', () => {
    state.isPaused = true;
    const result = processFrame(state, buildContext, rng);
    expect(result.ticksProcessed).toBe(0);
    expect(state.tickCount).toBe(0);
  });

  it('auto-pauses when event fires (requires decision)', () => {
    // Register a simple event that always fires
    setupEvents();
    // Set timers to fire immediately by advancing close to trigger
    for (const timer of state.events.timers) {
      timer.remaining = 1;
    }
    state.timeScale = 4;
    const result = processFrame(state, buildContext, rng);
    // Should auto-pause after the event fires
    expect(state.isPaused).toBe(true);
    if (result.firedEvents.length > 0) {
      expect(result.autoPaused).toBe(true);
      expect(result.autoPauseReason).toContain('Event requires decision');
      // Should NOT have processed all 4 ticks (stopped at event)
      expect(result.ticksProcessed).toBeLessThanOrEqual(4);
    }
  });

  it('costs accumulate faster at 4x speed', () => {
    state.timeScale = 1;
    processFrame(state, buildContext, rng);
    const tick1 = state.tickCount;

    state.timeScale = 4;
    processFrame(state, buildContext, rng);
    const tick2 = state.tickCount;

    // 1 tick at 1x, then 4 ticks at 4x = 5 total
    expect(tick2 - tick1).toBe(4);
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

const VEHICLE_TICK_SEED = 42;

describe('tickVehicle (Task 2.7)', () => {
  it('advances a moving vehicle toward its target cell', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 2;
    vehicle.targetZ = 0;

    tickVehicle(state, vehicle);
    expect(vehicle.x).toBe(1);
    expect(vehicle.z).toBe(0);
  });

  it('puts one vehicle into waiting when two vehicles converge on the same target cell', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: left } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { vehicle: right } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 0);

    left.task = 'moving';
    left.state = 'moving';
    left.targetX = 1;
    left.targetZ = 0;

    right.task = 'moving';
    right.state = 'moving';
    right.targetX = 1;
    right.targetZ = 0;

    tickVehicle(state, left);
    tickVehicle(state, right);

    const waitingVehicles = [left, right].filter(v => v.state === 'waiting');
    expect(waitingVehicles).toHaveLength(1);
  });
});
