// BlastSimulator2026 — createStepDeadline (#1224)
//
// A step's outer deadline measures the step's own work. Work explicitly marked
// `excluding(...)` (inline screenshot capture) is not charged to the budget.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStepDeadline } from '../../../../scripts/shared/step-deadline.js';

/** Observes how `expired` settles without leaving an unhandled rejection. */
function watch(p: Promise<unknown>) {
  const state: { rejected: boolean; error?: Error } = { rejected: false };
  p.catch((e: Error) => { state.rejected = true; state.error = e; });
  return state;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createStepDeadline — budget boundary', () => {
  it('has not expired one millisecond before the budget', async () => {
    const d = createStepDeadline(1000, () => 'x');
    const w = watch(d.expired);
    await vi.advanceTimersByTimeAsync(999);
    expect(w.rejected).toBe(false);
    expect(d.timedOut).toBe(false);
    d.stop();
  });

  it('rejects at exactly the budget with describe()\'s text and sets timedOut', async () => {
    const d = createStepDeadline(1000, () => 'Step 3 timed out after 1000ms (last progress: action 1/2 (click))');
    const w = watch(d.expired);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.rejected).toBe(true);
    expect(w.error).toBeInstanceOf(Error);
    expect(w.error!.message).toContain('Step 3 timed out after 1000ms (last progress: action 1/2 (click))');
    expect(d.timedOut).toBe(true);
  });

  it('evaluates describe() lazily, at expiry, not at creation', async () => {
    let progress = 'no interaction action has started yet';
    const describe = vi.fn(() => `last progress: ${progress}`);
    const d = createStepDeadline(1000, describe);
    const w = watch(d.expired);
    expect(describe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    progress = 'action 2/3 (waitUntil)';
    expect(describe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(describe).toHaveBeenCalledTimes(1);
    expect(w.error!.message).toContain('action 2/3 (waitUntil)');
  });
});

describe('createStepDeadline — excluding', () => {
  it('returns the value of the excluded work', async () => {
    const d = createStepDeadline(1000, () => 'x');
    await expect(d.excluding(async () => 42)).resolves.toBe(42);
    d.stop();
  });

  it('propagates a rejection from the excluded work and resumes the clock afterwards', async () => {
    const d = createStepDeadline(1000, () => 'overran');
    const w = watch(d.expired);
    await expect(d.excluding(async () => { throw new Error('capture failed'); })).rejects.toThrow('capture failed');
    // Clock resumed in `finally`: the full budget is still enforced.
    await vi.advanceTimersByTimeAsync(999);
    expect(w.rejected).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.rejected).toBe(true);
  });

  it('does not charge excluded time: 600 elapsed + 5000 excluded leaves 400', async () => {
    const d = createStepDeadline(1000, () => 'overran');
    const w = watch(d.expired);
    await vi.advanceTimersByTimeAsync(600);
    await d.excluding(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(w.rejected).toBe(false);
    await vi.advanceTimersByTimeAsync(399);
    expect(w.rejected).toBe(false);
    expect(d.timedOut).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.rejected).toBe(true);
    expect(d.timedOut).toBe(true);
  });

  it('does not expire while excluded work alone runs far past the budget', async () => {
    const d = createStepDeadline(1000, () => 'overran');
    const w = watch(d.expired);
    await d.excluding(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(w.rejected).toBe(false);
    d.stop();
  });

  it('keeps the clock paused through nested excluding until the outermost one ends', async () => {
    const d = createStepDeadline(1000, () => 'overran');
    const w = watch(d.expired);
    await d.excluding(async () => {
      await d.excluding(async () => { await vi.advanceTimersByTimeAsync(3000); });
      // Inner finished; the outer is still excluded, so the clock must not run.
      await vi.advanceTimersByTimeAsync(3000);
      expect(w.rejected).toBe(false);
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(w.rejected).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.rejected).toBe(true);
  });

  it('charges each separate excluded span nothing, across several spans', async () => {
    const d = createStepDeadline(1000, () => 'overran');
    const w = watch(d.expired);
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(300);
      await d.excluding(async () => { await vi.advanceTimersByTimeAsync(4000); });
    }
    // 900ms charged so far.
    expect(w.rejected).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(w.rejected).toBe(true);
  });
});

describe('createStepDeadline — stop', () => {
  it('prevents the rejection and leaves timedOut false', async () => {
    const d = createStepDeadline(1000, () => 'overran');
    const w = watch(d.expired);
    d.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(w.rejected).toBe(false);
    expect(d.timedOut).toBe(false);
  });

  it('leaves no pending timer behind', () => {
    const d = createStepDeadline(1000, () => 'x');
    d.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stays quiet when excluded work finishes after stop()', async () => {
    const d = createStepDeadline(1000, () => 'overran');
    const w = watch(d.expired);
    await d.excluding(async () => { d.stop(); await vi.advanceTimersByTimeAsync(5000); });
    await vi.advanceTimersByTimeAsync(10000);
    expect(w.rejected).toBe(false);
  });
});

describe('createStepDeadline — never raced', () => {
  it('raises no unhandled rejection when expiry is never awaited', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const d = createStepDeadline(1000, () => 'overran');
      await vi.advanceTimersByTimeAsync(5000);
      // Let any stray rejection reach the process-level handler.
      vi.useRealTimers();
      await new Promise(r => setImmediate(r));
      expect(d.timedOut).toBe(true);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('createStepDeadline — injected clock', () => {
  it('accepts a now() source without breaking the default contract', async () => {
    const d = createStepDeadline(1000, () => 'x', () => Date.now());
    const w = watch(d.expired);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.rejected).toBe(true);
  });
});
