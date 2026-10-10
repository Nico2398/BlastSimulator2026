// BlastSimulator2026 — nextHeldStallState: held-clock stall rule for awaitTutorialStep (#1598)
import { describe, it, expect } from 'vitest';
import { nextHeldStallState, HELD_STALL_FAIL_AFTER_MS, type HeldStallSample } from '../../../scripts/shared/interaction-driver.js';

const sample = (over: Partial<HeldStallSample> = {}): HeldStallSample => ({ stepId: 'a', stageIndex: 0, tick: 5, ...over });

describe('nextHeldStallState', () => {
  it('resets when the clock is not held', () => {
    expect(nextHeldStallState(sample(), { ...sample(), clockHeld: false }, 9000, 1000)).toEqual({ heldSinceMs: null, stalled: false });
  });

  it('starts the timer on the first held sample', () => {
    expect(nextHeldStallState(null, { ...sample(), clockHeld: true }, 1000, null)).toEqual({ heldSinceMs: 1000, stalled: false });
  });

  it('restarts the timer when step, stage or tick changes', () => {
    for (const over of [{ stepId: 'b' }, { stageIndex: 1 }, { tick: 6 }]) {
      expect(nextHeldStallState(sample(), { ...sample(over), clockHeld: true }, 4000, 1000)).toEqual({ heldSinceMs: 4000, stalled: false });
    }
  });

  it('stalls once held with no progress for the threshold', () => {
    const cur = { ...sample(), clockHeld: true };
    expect(nextHeldStallState(sample(), cur, 1000 + HELD_STALL_FAIL_AFTER_MS - 1, 1000).stalled).toBe(false);
    expect(nextHeldStallState(sample(), cur, 1000 + HELD_STALL_FAIL_AFTER_MS, 1000)).toEqual({ heldSinceMs: 1000, stalled: true });
  });
});
