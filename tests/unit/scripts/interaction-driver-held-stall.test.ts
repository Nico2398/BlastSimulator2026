// BlastSimulator2026 — tutorial real-clock stall detection (#1598)
//
// awaitTutorialStep runs the page's real guide clock. A step that holds that
// clock and never advances (no step, stage or tick change) is a deadlock a
// player would hit; the wait must fail by step id instead of timing out blind.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from 'puppeteer';
import {
  runAction,
  InteractionFailure,
  nextHeldStallState,
  HELD_STALL_FAIL_AFTER_MS,
  type HeldStallSample,
} from '../../../scripts/shared/interaction-driver.js';

const sample = (stepId = 'X', stageIndex = 0, tick = 100): HeldStallSample => ({ stepId, stageIndex, tick });
const held = (stepId = 'X', stageIndex = 0, tick = 100) => ({ ...sample(stepId, stageIndex, tick), clockHeld: true });
const free = (stepId = 'X', stageIndex = 0, tick = 100) => ({ ...sample(stepId, stageIndex, tick), clockHeld: false });

describe('HELD_STALL_FAIL_AFTER_MS', () => {
  it('is 3000 ms', () => {
    expect(HELD_STALL_FAIL_AFTER_MS).toBe(3000);
  });
});

describe('nextHeldStallState (pure)', () => {
  it('first held reading starts the timer and is not stalled', () => {
    expect(nextHeldStallState(null, held(), 1000, null)).toEqual({ heldSinceMs: 1000, stalled: false });
  });

  it('unchanged key under the threshold keeps the timer and is not stalled', () => {
    const r = nextHeldStallState(sample(), held(), 1000 + HELD_STALL_FAIL_AFTER_MS - 1, 1000);
    expect(r).toEqual({ heldSinceMs: 1000, stalled: false });
  });

  it('unchanged key at exactly the threshold is stalled', () => {
    const r = nextHeldStallState(sample(), held(), 1000 + HELD_STALL_FAIL_AFTER_MS, 1000);
    expect(r.stalled).toBe(true);
    expect(r.heldSinceMs).toBe(1000);
  });

  it('unchanged key well past the threshold is stalled', () => {
    expect(nextHeldStallState(sample(), held(), 60_000, 1000).stalled).toBe(true);
  });

  it('clock not held resets the timer and is never stalled', () => {
    expect(nextHeldStallState(sample(), free(), 60_000, 1000)).toEqual({ heldSinceMs: null, stalled: false });
  });

  it('tick change while held restarts the timer from now', () => {
    expect(nextHeldStallState(sample('X', 0, 100), held('X', 0, 101), 9000, 1000)).toEqual({ heldSinceMs: 9000, stalled: false });
  });

  it('stage change while held restarts the timer from now', () => {
    expect(nextHeldStallState(sample('X', 0, 100), held('X', 1, 100), 9000, 1000)).toEqual({ heldSinceMs: 9000, stalled: false });
  });

  it('step change while held restarts the timer from now', () => {
    expect(nextHeldStallState(sample('X', 0, 100), held('Y', 0, 100), 9000, 1000)).toEqual({ heldSinceMs: 9000, stalled: false });
  });

  it('held with no remembered timer (heldSinceMs null) starts it now, never stalled', () => {
    expect(nextHeldStallState(sample(), held(), 9000, null)).toEqual({ heldSinceMs: 9000, stalled: false });
  });

  it('release then re-hold restarts the timer', () => {
    const released = nextHeldStallState(sample(), free(), 2000, 1000);
    const again = nextHeldStallState(sample(), held(), 5000, released.heldSinceMs);
    expect(again).toEqual({ heldSinceMs: 5000, stalled: false });
  });
});

interface Snap { stepId: string | null; clockHeld: boolean; stageIndex: number; tick: number }

/** Page whose tutorial/game state at poll n comes from `script(n)`; records setAutoTick calls. */
function scriptedPage(script: (poll: number, nowMs: number) => Snap) {
  const autoTick: boolean[] = [];
  let polls = 0;
  let last: Snap = script(0, Date.now());
  const evaluate = vi.fn(async (fn: unknown, ...args: unknown[]) => {
    const src = String(fn);
    if (src.includes('__setAutoTick')) { autoTick.push(args[0] as boolean); return null; }
    if (src.includes('__tutorialState')) {
      last = script(polls++, Date.now());
      return { active: true, stepIndex: 0, stepId: last.stepId, title: 'T', total: 10, clockHeld: last.clockHeld, stageIndex: last.stageIndex, stageTotal: 3, stageTarget: null };
    }
    if (src.includes('__gameState')) return { tickCount: last.tick };
    if (src.includes('__uiActions')) return [];
    return null;
  });
  return { page: { evaluate } as unknown as Page, autoTick };
}

describe('awaitTutorialStep — held-clock stall detection', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const run = (page: Page, stepId: string, timeoutMs = 120_000) => {
    const settled = runAction(page, { do: 'awaitTutorialStep', stepId, timeoutMs } as never)
      .then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
    return settled;
  };

  it('throws InteractionFailure naming the step and "clock held" when held with no progress', async () => {
    const { page, autoTick } = scriptedPage(() => ({ stepId: 'X', clockHeld: true, stageIndex: 1, tick: 500 }));
    const result = run(page, 'never');
    await vi.advanceTimersByTimeAsync(HELD_STALL_FAIL_AFTER_MS + 2000);
    const r = await result;
    expect(r.ok).toBe(false);
    const err = (r as { error: unknown }).error;
    expect(err).toBeInstanceOf(InteractionFailure);
    expect((err as Error).message).toMatch(/on "X"/);
    expect((err as Error).message).toContain('clock held');
    expect(autoTick[autoTick.length - 1]).toBe(false);
  });

  it('restores setAutoTick(false) after a stall throw and had enabled it first', async () => {
    const { page, autoTick } = scriptedPage(() => ({ stepId: 'X', clockHeld: true, stageIndex: 0, tick: 7 }));
    const result = run(page, 'never');
    await vi.advanceTimersByTimeAsync(HELD_STALL_FAIL_AFTER_MS + 2000);
    await result;
    expect(autoTick[0]).toBe(true);
    expect(autoTick[autoTick.length - 1]).toBe(false);
  });

  it('does not throw when the hold is released before the threshold; resolves on the target step', async () => {
    // Scripted by poll index: held twice, released once, then target.
    const seq: Snap[] = [
      { stepId: 'X', clockHeld: true, stageIndex: 0, tick: 1 },
      { stepId: 'X', clockHeld: true, stageIndex: 0, tick: 1 },
      { stepId: 'X', clockHeld: false, stageIndex: 0, tick: 1 },
      { stepId: 'X', clockHeld: false, stageIndex: 0, tick: 1 },
      { stepId: 'Y', clockHeld: false, stageIndex: 0, tick: 2 },
    ];
    const p = scriptedPage((n) => seq[Math.min(n, seq.length - 1)]!);
    const result = run(p.page, 'Y');
    await vi.advanceTimersByTimeAsync(5000);
    expect((await result).ok).toBe(true);
    expect(p.autoTick[p.autoTick.length - 1]).toBe(false);
  });

  it('does not throw while held but the tick keeps advancing', async () => {
    const p = scriptedPage((n) => ({ stepId: n >= 40 ? 'Y' : 'X', clockHeld: true, stageIndex: 0, tick: n }));
    const result = run(p.page, 'Y');
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await result).ok).toBe(true);
  });

  it('does not throw while held but the stage keeps advancing', async () => {
    const p = scriptedPage((n) => ({ stepId: n >= 40 ? 'Y' : 'X', clockHeld: true, stageIndex: n, tick: 5 }));
    const result = run(p.page, 'Y');
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await result).ok).toBe(true);
  });

  it('resolves when the target step is reached on the same poll the clock is held', async () => {
    const p = scriptedPage(() => ({ stepId: 'Y', clockHeld: true, stageIndex: 0, tick: 3 }));
    const result = run(p.page, 'Y');
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).ok).toBe(true);
    expect(p.autoTick[p.autoTick.length - 1]).toBe(false);
  });

  it('an unheld stuck step still ends with the ordinary "never reached" failure, not a clock-held one', async () => {
    const p = scriptedPage(() => ({ stepId: 'X', clockHeld: false, stageIndex: 0, tick: 3 }));
    const result = run(p.page, 'Y', 10_000);
    await vi.advanceTimersByTimeAsync(HELD_STALL_FAIL_AFTER_MS + 2000);
    // Past the stall window but inside the deadline: still waiting.
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await result;
    expect(r.ok).toBe(false);
    const msg = ((r as { error: unknown }).error as Error).message;
    expect(msg).toContain('never reached');
    expect(msg).not.toContain('clock held');
  });
});
