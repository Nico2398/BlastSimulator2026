// BlastSimulator2026 — Unit tests: checkGameOverConditions (#1086)
//
// Core-owned relocation of tickGameOver.ts's checkGameOverConditions.
// runTick's own black-box tests and the level*-lose-*.integration.test.ts
// suites already exercise this indirectly; these tests call it directly per
// core-purity.md's "adding an exported function here means adding its unit
// test in the mirrored tests/unit/ path" convention.

import { describe, it, expect, vi } from 'vitest';
import { checkGameOverConditions, hasLevelEnded } from '../../../src/core/engine/GameOverConditions.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { BANKRUPTCY_THRESHOLD, BANKRUPTCY_GRACE_TICKS } from '../../../src/core/campaign/Bankruptcy.js';
import { ECOLOGICAL_SHUTDOWN_TICKS } from '../../../src/core/campaign/EcologicalDisaster.js';

const SEED = 42;

describe('checkGameOverConditions — bankruptcy', () => {
  it('reports bankrupted and sets levelEndReason once the grace period elapses', () => {
    const state = createGame({ seed: SEED });
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    state.bankruptcy.ticksBelowThreshold = BANKRUPTCY_GRACE_TICKS - 1;

    const report = checkGameOverConditions(state, new EventEmitter());

    expect(report.bankrupted).toBe(true);
    expect(report.levelCompleted).toBe(false);
    expect(report.ecoShutdown).toBe(false);
    expect(report.arrested).toBe(false);
    expect(report.revolted).toBe(false);
    expect(report.levelEndReason).toBe('bankruptcy');
    expect(state.levelEnded).toBe(true);
  });

  it('reports no game-over while every condition is under threshold', () => {
    const state = createGame({ seed: SEED });

    const report = checkGameOverConditions(state, new EventEmitter());

    expect(report.levelCompleted).toBe(false);
    expect(report.bankrupted).toBe(false);
    expect(report.ecoShutdown).toBe(false);
    expect(report.arrested).toBe(false);
    expect(report.revolted).toBe(false);
    expect(report.levelEndReason).toBeNull();
    expect(state.levelEnded).toBe(false);
  });
});

describe('checkGameOverConditions — tie-break', () => {
  it('when bankruptcy and ecological shutdown both fire the same tick, only bankruptcy (checked first) sets levelEndReason', () => {
    const state = createGame({ seed: SEED });
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    state.bankruptcy.ticksBelowThreshold = BANKRUPTCY_GRACE_TICKS - 1;
    state.scores.ecology = 0;
    state.ecological.ticksAtZero = ECOLOGICAL_SHUTDOWN_TICKS - 1;

    const report = checkGameOverConditions(state, new EventEmitter());

    // Both conditions genuinely fired this tick — neither is silently
    // suppressed — but only the first-checked one claims levelEndReason.
    expect(report.bankrupted).toBe(true);
    expect(report.ecoShutdown).toBe(true);
    expect(report.levelEndReason).toBe('bankruptcy');
  });
});

// ── #1313: nothing runs after the level ended ─────────────────────────

describe('hasLevelEnded (#1313)', () => {
  it('is false while levelEndReason is null', () => {
    expect(hasLevelEnded({ levelEndReason: null })).toBe(false);
  });

  it.each(['completed', 'bankruptcy', 'ecological_shutdown', 'arrest', 'worker_revolt'] as const)(
    'is true once levelEndReason is %s',
    (reason) => {
      expect(hasLevelEnded({ levelEndReason: reason })).toBe(true);
    },
  );

  it('reads levelEndReason, not the levelEnded flag', () => {
    const state = createGame({ seed: SEED });
    state.levelEnded = true;
    state.levelEndReason = null;
    expect(hasLevelEnded(state)).toBe(false);
  });
});

describe('checkGameOverConditions after the level ended (#1313)', () => {
  function endedState(reason: 'completed' | 'bankruptcy') {
    const state = createGame({ seed: SEED });
    state.levelEnded = true;
    state.levelEndReason = reason;
    return state;
  }

  it('returns an inert report that preserves levelEndReason', () => {
    const state = endedState('completed');
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    state.bankruptcy.ticksBelowThreshold = BANKRUPTCY_GRACE_TICKS - 1;

    const report = checkGameOverConditions(state, new EventEmitter());

    expect(report).toEqual({
      levelCompleted: false,
      bankrupted: false,
      ecoShutdown: false,
      arrested: false,
      revolted: false,
      levelEndReason: 'completed',
    });
    expect(state.levelEndReason).toBe('completed');
  });

  it('does not emit bankruptcy events on a won level', () => {
    const state = endedState('completed');
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    state.bankruptcy.ticksBelowThreshold = BANKRUPTCY_GRACE_TICKS - 1;
    const emitter = new EventEmitter();
    const warning = vi.fn();
    const triggered = vi.fn();
    emitter.on('bankruptcy:warning', warning);
    emitter.on('bankruptcy:triggered', triggered);

    for (let i = 0; i < 50; i++) checkGameOverConditions(state, emitter);

    expect(warning).not.toHaveBeenCalled();
    expect(triggered).not.toHaveBeenCalled();
    expect(state.levelEndReason).toBe('completed');
  });

  it('leaves streak counters and levelStats unchanged', () => {
    const state = endedState('completed');
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    state.bankruptcy.ticksBelowThreshold = 7;
    state.scores.ecology = 0;
    state.ecological.ticksAtZero = 3;
    const wealthBefore = state.levelStats.totalWealth;
    const statsBefore = JSON.stringify({ ...state.levelStats, uniqueOresExtracted: [...state.levelStats.uniqueOresExtracted] });

    checkGameOverConditions(state, new EventEmitter());

    expect(state.bankruptcy.ticksBelowThreshold).toBe(7);
    expect(state.ecological.ticksAtZero).toBe(3);
    expect(state.levelStats.totalWealth).toBe(wealthBefore);
    expect(JSON.stringify({ ...state.levelStats, uniqueOresExtracted: [...state.levelStats.uniqueOresExtracted] })).toBe(statsBefore);
  });

  it('a lost level does not switch to another reason', () => {
    const state = endedState('bankruptcy');
    state.scores.ecology = 0;
    state.ecological.ticksAtZero = ECOLOGICAL_SHUTDOWN_TICKS - 1;

    const report = checkGameOverConditions(state, new EventEmitter());

    expect(report.ecoShutdown).toBe(false);
    expect(report.levelEndReason).toBe('bankruptcy');
    expect(state.levelEndReason).toBe('bankruptcy');
  });
});
