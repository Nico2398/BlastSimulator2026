// BlastSimulator2026 — Unit tests: checkGameOverConditions (#1086)
//
// Core-owned relocation of tickGameOver.ts's checkGameOverConditions.
// runTick's own black-box tests and the level*-lose-*.integration.test.ts
// suites already exercise this indirectly; these tests call it directly per
// core-purity.md's "adding an exported function here means adding its unit
// test in the mirrored tests/unit/ path" convention.

import { describe, it, expect } from 'vitest';
import { checkGameOverConditions } from '../../../src/core/engine/GameOverConditions.js';
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
