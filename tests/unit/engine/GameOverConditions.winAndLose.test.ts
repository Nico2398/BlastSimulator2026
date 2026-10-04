// BlastSimulator2026 — checkGameOverConditions: win and lose on the same tick (#1313)
// 'completed' wins the tie; the lose checks still run that tick, only the
// ones after it are skipped. The win is forced through a mocked
// checkLevelComplete so the test doesn't depend on campaign balance.

import { describe, it, expect, vi } from 'vitest';

// Like the real one, a trigger sets levelEnded (single writer, #1310).
vi.mock('../../../src/core/campaign/LevelTransition.js', () => ({
  checkLevelComplete: (state: { levelEnded: boolean }) => {
    state.levelEnded = true;
    return { triggered: true };
  },
}));

import { checkGameOverConditions } from '../../../src/core/engine/GameOverConditions.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { BANKRUPTCY_THRESHOLD, BANKRUPTCY_GRACE_TICKS } from '../../../src/core/campaign/Bankruptcy.js';

describe('checkGameOverConditions — win and lose on the same tick (#1313)', () => {
  it('reports completed when bankruptcy triggers the same tick, and a later call is inert', () => {
    const state = createGame({ seed: 42 });
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    state.bankruptcy.ticksBelowThreshold = BANKRUPTCY_GRACE_TICKS - 1;
    const emitter = new EventEmitter();

    const first = checkGameOverConditions(state, emitter);
    expect(first.levelCompleted).toBe(true);
    expect(first.levelEndReason).toBe('completed');

    const second = checkGameOverConditions(state, emitter);
    expect(second.levelCompleted).toBe(false);
    expect(second.bankrupted).toBe(false);
    expect(second.levelEndReason).toBe('completed');
  });
});
