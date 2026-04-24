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
    expect(vehicle.state).toBe('moving');
    expect(vehicle.task).toBe('moving');

    tickVehicle(state, vehicle);
    expect(vehicle.x).toBe(2);
    expect(vehicle.z).toBe(0);
    expect(vehicle.state).toBe('idle');
    expect(vehicle.task).toBe('idle');
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
    const movingVehicles = [left, right].filter(v => v.state !== 'waiting');
    expect(movingVehicles).toHaveLength(1);
    expect(movingVehicles[0]!.x).toBe(1);
    expect(movingVehicles[0]!.z).toBe(0);
  });

  it('resumes waiting vehicle movement when the blocked cell becomes free', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { vehicle: waiting } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 0);

    blocker.task = 'moving';
    blocker.state = 'moving';
    blocker.targetX = 1;
    blocker.targetZ = 0;

    waiting.task = 'moving';
    waiting.state = 'moving';
    waiting.targetX = 1;
    waiting.targetZ = 0;

    tickVehicle(state, blocker);
    tickVehicle(state, waiting);
    expect(waiting.state).toBe('waiting');

    blocker.task = 'moving';
    blocker.state = 'moving';
    blocker.targetX = 0;
    blocker.targetZ = 0;
    tickVehicle(state, blocker);

    tickVehicle(state, waiting);
    expect(waiting.x).toBe(1);
    expect(waiting.z).toBe(0);
    expect(waiting.state).toBe('idle');
  });
});

// ── Task 2.8: Vehicle.waitingTicks tracking ──────────────────────────────────

describe('tickVehicle — waitingTicks (Task 2.8)', () => {
  // Vehicle.waitingTicks is added to the Vehicle interface in Task 2.8.
  // It is not present yet, so we access it via `(v as any).waitingTicks` to
  // keep the existing TypeScript type-check clean while these tests are red.

  it('increments waitingTicks by 1 on each tick the vehicle remains in waiting state', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { vehicle: waiting } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);

    // Both vehicles head for the same cell (1, 0)
    blocker.task = 'moving'; blocker.state = 'moving';
    blocker.targetX = 1;     blocker.targetZ = 0;

    waiting.task = 'moving'; waiting.state = 'moving';
    waiting.targetX = 1;     waiting.targetZ = 0;

    // Tick 1 — blocker arrives at (1,0); debris_hauler is blocked → waiting
    tickVehicle(state, blocker);
    tickVehicle(state, waiting);
    expect(waiting.state).toBe('waiting');
    expect((waiting as any).waitingTicks).toBe(1);

    // Tick 2 — blocker is idle at (1,0), still blocking; waitingTicks → 2
    tickVehicle(state, blocker); // no-op (task = 'idle')
    tickVehicle(state, waiting);
    expect((waiting as any).waitingTicks).toBe(2);

    // Tick 3 — same situation; waitingTicks → 3
    tickVehicle(state, blocker);
    tickVehicle(state, waiting);
    expect((waiting as any).waitingTicks).toBe(3);
  });

  it('resets waitingTicks to 0 when the vehicle transitions from waiting to moving', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { vehicle: waiting } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);

    blocker.task = 'moving'; blocker.state = 'moving';
    blocker.targetX = 1;     blocker.targetZ = 0;

    waiting.task = 'moving'; waiting.state = 'moving';
    waiting.targetX = 1;     waiting.targetZ = 0;

    // Build up waitingTicks
    tickVehicle(state, blocker);
    tickVehicle(state, waiting);
    expect(waiting.state).toBe('waiting');
    expect((waiting as any).waitingTicks).toBe(1);

    tickVehicle(state, blocker); // no-op
    tickVehicle(state, waiting);
    expect((waiting as any).waitingTicks).toBe(2);

    // Teleport the blocker away so cell (1,0) is free
    blocker.x = 99;
    blocker.z = 99;

    // Next tickVehicle — waiting vehicle finally moves; waitingTicks must reset
    tickVehicle(state, waiting);
    expect(waiting.state).not.toBe('waiting');
    expect((waiting as any).waitingTicks).toBe(0);
  });

  it('resets waitingTicks to 0 when the vehicle reaches its target and becomes idle', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: v } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);

    // Manually prime waitingTicks to a non-zero value (simulates prior waiting)
    (v as any).waitingTicks = 5;

    // Vehicle moves straight to its target — no blocking
    v.task = 'moving'; v.state = 'moving';
    v.targetX = 1;     v.targetZ = 0;

    tickVehicle(state, v);

    // Vehicle reached target → idle; waitingTicks must be 0
    expect(v.state).toBe('idle');
    expect((v as any).waitingTicks).toBe(0);
  });
});
