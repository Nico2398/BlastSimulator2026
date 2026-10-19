// BlastSimulator2026 — an unseen mine-grade approval pauses the game after the tick (#1926)
import { describe, it, expect } from 'vitest';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { Random } from '../../../src/core/math/Random.js';

function tickOnce(state: ReturnType<typeof createGame>): void {
  state.events.eventFreqMultiplier = 0;
  runTick(state, null, new Random(state.seed + state.tickCount), new EventEmitter(), { checkInvariants: false });
}

describe('TickPipeline approval pause (#1926)', () => {
  it('pauses when the tick leaves an unseen approval', () => {
    const state = createGame({ seed: 42 });
    state.grade = { ...createGradeState(), unseenApproval: 1 };
    tickOnce(state);
    expect(state.isPaused).toBe(true);
  });

  it('pauses on the very tick the countdown completes', () => {
    const state = createGame({ seed: 42 });
    state.grade = { ...createGradeState(), pending: { toGrade: 1, ticksLeft: 1 } };
    tickOnce(state);
    expect(state.grade.grade).toBe(1);
    expect(state.grade.unseenApproval).toBe(1);
    expect(state.isPaused).toBe(true);
  });

  it('does not pause with no unseen approval', () => {
    const state = createGame({ seed: 42 });
    state.grade = createGradeState();
    tickOnce(state);
    expect(state.isPaused).toBe(false);
  });

  it('does not pause on a site without a permit ladder', () => {
    const state = createGame({ seed: 42 });
    delete state.grade;
    tickOnce(state);
    expect(state.isPaused).toBe(false);
  });

  it('does not pause while the application is still pending', () => {
    const state = createGame({ seed: 42 });
    state.grade = { ...createGradeState(), pending: { toGrade: 1, ticksLeft: 5 } };
    tickOnce(state);
    expect(state.isPaused).toBe(false);
  });
});
