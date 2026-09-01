// BlastSimulator2026 — Scenario interaction mechanism tests (issue #479)
//
// Interaction mode used to let any step reach the console instead of
// clicking — 94% of interaction actions across the suite were `command`,
// measured in #479. These tests cover the mechanism that closes that gap:
// a player-marked step's interaction may never fall back to a console
// command, and a step whose click cannot actually complete fails the
// scenario and names the control (issue #515's playability fold-in).
//
// No real Puppeteer browser is involved — `Page` is faked at the I/O
// boundary (`evaluate`, `click`, `waitForSelector`) so these stay in the
// `logic` channel (tests/unit/, no browser) while still exercising the real
// control flow in interaction-executor.ts and scenario-interaction-runner.ts.

import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'puppeteer';
import {
  executeActionOnPage, resolveEventIfPendingOnPage, CLOCK_HELD_FAIL_AFTER_POLLS,
} from '../../scripts/shared/interaction-executor.js';
import { describeStepFailure } from '../../scripts/scenario-interaction-runner.js';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';

function fakePage(overrides: Partial<Record<'evaluate' | 'click' | 'waitForSelector', unknown>> = {}): Page {
  return {
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
    click: vi.fn(),
    ...overrides,
  } as unknown as Page;
}

describe('executeActionOnPage — player steps never fall back to a console command (issue #479)', () => {
  it('throws for a command action inside a player-marked step, naming the step, before touching the page', async () => {
    const page = fakePage();
    const step: ScenarioStepDef = {
      command: 'vehicle driver 1 4',
      description: 'vehicle-buy-assign complete',
      role: 'player',
      interaction: [{ type: 'command', command: 'vehicle driver 1 4' }],
    };

    await expect(
      executeActionOnPage(page, { type: 'command', command: 'vehicle driver 1 4' }, step),
    ).rejects.toThrow(/vehicle-buy-assign complete/);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('runs a command action inside a setup-marked step when it is on the reused allowlist', async () => {
    const page = fakePage();
    const step: ScenarioStepDef = {
      command: 'new_game seed:42',
      role: 'setup',
      interaction: [{ type: 'command', command: 'new_game seed:42' }],
    };

    await executeActionOnPage(page, { type: 'command', command: 'new_game seed:42' }, step);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('rejects a command action inside a setup-marked step when it is not on the allowlist', async () => {
    const page = fakePage();
    const cheat = 'employee assign_skill 1 skill:geology level:3';
    const step: ScenarioStepDef = {
      command: cheat,
      role: 'setup',
      interaction: [{ type: 'command', command: cheat }],
    };

    await expect(
      executeActionOnPage(page, { type: 'command', command: cheat }, step),
    ).rejects.toThrow(/not on the setup allowlist/);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('runs a command action when the step carries no role (legacy, unconstrained)', async () => {
    const page = fakePage();
    const step: ScenarioStepDef = {
      command: 'build freight_warehouse at:4,4',
      interaction: [{ type: 'command', command: 'build freight_warehouse at:4,4' }],
    };

    await executeActionOnPage(page, { type: 'command', command: 'build freight_warehouse at:4,4' }, step);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});

describe('a player step whose click cannot complete fails and names the selector', () => {
  it('clickSelector refused by the browser throws an error naming the selector and the reason, which the runner then attributes to the player step', async () => {
    const evaluate = vi.fn()
      // __probeSelector call: reports usable, so the loop proceeds to click —
      // the click itself is what gets refused (a control can flip disabled
      // between the probe and the click; #481).
      .mockResolvedValueOnce(null)
      // inspectSelector's report, read back after page.click rejects.
      .mockResolvedValueOnce({
        found: true,
        pointerEvents: 'auto',
        display: 'block',
        visibility: 'visible',
        disabled: true,
        width: 80,
        height: 24,
        matchCount: 1,
      });
    const page = fakePage({
      evaluate,
      click: vi.fn().mockRejectedValue(new Error('Node is either not clickable or not an Element')),
    });
    const selector = '#bs-vehicle-panel .bs-vehicle-assign-btn';
    const step: ScenarioStepDef = {
      command: 'vehicle driver 1 4',
      description: 'vehicle-buy-assign complete',
      role: 'player',
      interaction: [{ type: 'clickSelector', selector }],
    };

    let caught: unknown;
    try {
      await executeActionOnPage(page, { type: 'clickSelector', selector }, step);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const rawMessage = (caught as Error).message;
    expect(rawMessage).toContain(selector);
    expect(rawMessage).toContain('element is disabled');

    // scenario-interaction-runner.ts's framing on top: unambiguous that this
    // was a player step, and it did not complete — not merely "an error".
    const reported = describeStepFailure(step, caught);
    expect(reported).toContain('player step "vehicle-buy-assign complete" did not complete');
    expect(reported).toContain(selector);
    expect(reported).toContain('element is disabled');
  });
});

describe('clickSelector retries once when the target vanishes between the wait and the click (#929 CI finding)', () => {
  it('retries the whole probe-then-click cycle once when a background re-render (e.g. FleetPanel rebuilding every card on an unrelated vehicle\'s signature change) swaps the node out from under the click, and succeeds on the second attempt', async () => {
    const selector = '#bs-vehicle-panel [data-vehicle-id="2"] .bsx-btn-danger';
    const evaluate = vi.fn()
      // 1st probe: usable.
      .mockResolvedValueOnce(null)
      // inspectSelector after the 1st click throws: the rebuild already
      // swapped this node out — genuinely gone, not covered/disabled.
      .mockResolvedValueOnce({ found: false })
      // 2nd probe (retry): usable again, against the replacement node.
      .mockResolvedValueOnce(null);
    const click = vi.fn()
      .mockRejectedValueOnce(new Error('Node is either not clickable or not an Element'))
      .mockResolvedValueOnce(undefined);
    const page = fakePage({ evaluate, click });
    const step: ScenarioStepDef = {
      command: 'vehicle scrap 2',
      description: 'scrap the parked debris_hauler',
      role: 'player',
      interaction: [{ type: 'clickSelector', selector }],
    };

    await expect(
      executeActionOnPage(page, { type: 'clickSelector', selector }, step),
    ).resolves.toBeUndefined();
    expect(click).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenNthCalledWith(1, selector, { button: 'left' });
    expect(click).toHaveBeenNthCalledWith(2, selector, { button: 'left' });
  });

  it('still fails loudly, naming the selector, when the target is genuinely gone on the retry too (bounded to one retry)', async () => {
    const selector = '#bs-vehicle-panel [data-vehicle-id="2"] .bsx-btn-danger';
    const evaluate = vi.fn()
      .mockResolvedValueOnce(null) // 1st probe: usable
      .mockResolvedValueOnce({ found: false }) // inspect after 1st click throw
      .mockResolvedValueOnce(null) // 2nd probe (retry): usable
      .mockResolvedValueOnce({ found: false }); // inspect after 2nd click throw
    const click = vi.fn().mockRejectedValue(new Error('Node is either not clickable or not an Element'));
    const page = fakePage({ evaluate, click });
    const step: ScenarioStepDef = {
      command: 'vehicle scrap 2',
      description: 'scrap the parked debris_hauler',
      role: 'player',
      interaction: [{ type: 'clickSelector', selector }],
    };

    await expect(
      executeActionOnPage(page, { type: 'clickSelector', selector }, step),
    ).rejects.toThrow('element vanished from the DOM between the wait and the click');
    expect(click).toHaveBeenCalledTimes(2);
  });
});

describe('executeActionOnPage — waitUntil (issue #590, #601)', () => {
  it('resolves once the polled field reaches the target, looping the console\'s own deterministic tick 1', async () => {
    // #601: one page.evaluate call per tick (tick 1 + event-status check +
    // conditional resolve + field read, all inside the same browser-side
    // callback) — no real-time auto-tick toggling any more.
    const evaluate = vi.fn().mockResolvedValueOnce(25);
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'wait_until field:holeCount equals:25 max_ticks:400', role: 'setup' };
    const action = { type: 'waitUntil' as const, field: 'holeCount', equals: 25, maxTicks: 400, timeoutMs: 30000 };

    await executeActionOnPage(page, action, step);

    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('exhausts its tick budget and throws naming the field, its last value, and the tick count', async () => {
    const evaluate = vi.fn().mockResolvedValue(3);
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'wait_until field:holeCount equals:25 max_ticks:1', role: 'setup' };
    const action = { type: 'waitUntil' as const, field: 'holeCount', equals: 25, maxTicks: 1, timeoutMs: 30000 };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow(
      /"holeCount" never reached 25 — stalled at 3 after 1 tick\(s\)/,
    );
  });

  // Item 5 of the PR #616 review round: a step that times out on the outer
  // deadline (several actions' combined time, none individually stalling)
  // should still name the field/value/tick-count the runner last observed
  // through waitUntil, instead of a bare "Step N timed out after Xms".
  it('reports its field/value/tick-count on every tick via onProgress', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(25);
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'wait_until field:holeCount equals:25 max_ticks:400', role: 'setup' };
    const action = { type: 'waitUntil' as const, field: 'holeCount', equals: 25, maxTicks: 400, timeoutMs: 30000 };
    const progress: string[] = [];

    await executeActionOnPage(page, action, step, (detail) => progress.push(detail));

    expect(progress).toEqual([
      'waitUntil "holeCount" = 3 (want 25), tick 1/400',
      'waitUntil "holeCount" = 9 (want 25), tick 2/400',
      'waitUntil "holeCount" = 25 (want 25), tick 3/400',
    ]);
  });
});

describe('executeActionOnPage — waitForTutorialStep (issue #601, #631)', () => {
  it('resolves once the tutorial reaches the named step, looping the console\'s own deterministic tick 1', async () => {
    // #601: same tick-1-loop rewrite as waitUntil, but deliberately does NOT
    // auto-resolve a pending event (a scenario can wait for the tutorial's
    // own "an event just fired" checkpoint by stepId, with a dedicated later
    // player step clicking the real dialog).
    const evaluate = vi.fn().mockResolvedValueOnce({ active: true, stepId: 'drill-plan', stageTarget: 'grid-tool' });
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'wait_for_tutorial_step step:drill-plan', role: 'setup' };
    const action = { type: 'waitForTutorialStep' as const, stepId: 'drill-plan', maxTicks: 400, timeout: 30000 };

    await executeActionOnPage(page, action, step);

    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('resolves without throwing once the tutorial ends (goes inactive) before the named step is ever reached', async () => {
    const evaluate = vi.fn().mockResolvedValueOnce({ active: false, stepId: null, stageTarget: null });
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'wait_for_tutorial_step step:drill-plan', role: 'setup' };
    const action = { type: 'waitForTutorialStep' as const, stepId: 'drill-plan', maxTicks: 400, timeout: 30000 };

    await expect(executeActionOnPage(page, action, step)).resolves.toBeUndefined();
  });

  it('exhausts its tick budget and throws naming the wanted step, the tutorial\'s current step, and the live control', async () => {
    const evaluate = vi.fn().mockResolvedValue({ active: true, stepId: 'grid-select', stageTarget: 'grid-tool' });
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'wait_for_tutorial_step step:drill-plan', role: 'setup' };
    const action = { type: 'waitForTutorialStep' as const, stepId: 'drill-plan', maxTicks: 1, timeout: 30000 };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow(
      /tutorial never reached "drill-plan" — it is on "grid-select", live control grid-tool, after 1 tick\(s\)/,
    );
  });

  it('reports the tutorial\'s current step and live control on every tick via onProgress', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce({ active: true, stepId: 'grid-select', stageTarget: 'grid-tool' })
      .mockResolvedValueOnce({ active: true, stepId: 'drill-plan', stageTarget: 'charge-tool' });
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'wait_for_tutorial_step step:drill-plan', role: 'setup' };
    const action = { type: 'waitForTutorialStep' as const, stepId: 'drill-plan', maxTicks: 400, timeout: 30000 };
    const progress: string[] = [];

    await executeActionOnPage(page, action, step, (detail) => progress.push(detail));

    expect(progress).toEqual([
      'waitForTutorialStep on "grid-select", live control grid-tool, want "drill-plan", tick 1/400',
      'waitForTutorialStep on "drill-plan", live control charge-tool, want "drill-plan", tick 2/400',
    ]);
  });

  // Issue #650: a timeout caused by a pending event looks identical to an
  // ordinary stall today — the thrown message names only the step it's
  // stuck on, not that a dialog is blocking every tick's `tick 1`. These
  // cases pin the new cause-naming behavior without touching the pre-#650
  // cases above, which continue to prove the ordinary-timeout message is
  // byte-for-byte unchanged when no event was ever pending.
  it('names a pending event as the timeout cause when every tick was blocked by one', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      active: true,
      stepId: 'grid-select',
      stageTarget: 'grid-tool',
      pendingEvent: true,
    });
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'wait_for_tutorial_step step:drill-plan', role: 'setup' };
    const action = { type: 'waitForTutorialStep' as const, stepId: 'drill-plan', maxTicks: 3, timeout: 30000 };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow(
      /tutorial never reached "drill-plan" — it is on "grid-select", live control grid-tool, after 3 tick\(s\); blocked by a pending event for 3 tick\(s\)/,
    );
    // Still exactly one page.evaluate() round trip per loop iteration — the
    // pendingEvent read must fold into the existing call, not add a second.
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it('throws today\'s exact message, with no pending-event suffix, when no tick was ever blocked', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      active: true,
      stepId: 'grid-select',
      stageTarget: 'grid-tool',
      pendingEvent: false,
    });
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'wait_for_tutorial_step step:drill-plan', role: 'setup' };
    const action = { type: 'waitForTutorialStep' as const, stepId: 'drill-plan', maxTicks: 3, timeout: 30000 };

    let thrown: Error | undefined;
    try {
      await executeActionOnPage(page, action, step);
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown?.message).toBe(
      'waitForTutorialStep: tutorial never reached "drill-plan"'
      + ' — it is on "grid-select", live control grid-tool, after 3 tick(s)',
    );
    expect(thrown?.message).not.toContain('blocked by a pending event');
  });

  it('counts only the trailing consecutive run of blocked ticks, resetting on any clean tick', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce({ active: true, stepId: 'grid-select', stageTarget: 'grid-tool', pendingEvent: true })
      .mockResolvedValueOnce({ active: true, stepId: 'grid-select', stageTarget: 'grid-tool', pendingEvent: true })
      .mockResolvedValueOnce({ active: true, stepId: 'grid-select', stageTarget: 'grid-tool', pendingEvent: false })
      .mockResolvedValueOnce({ active: true, stepId: 'grid-select', stageTarget: 'grid-tool', pendingEvent: true });
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'wait_for_tutorial_step step:drill-plan', role: 'setup' };
    const action = { type: 'waitForTutorialStep' as const, stepId: 'drill-plan', maxTicks: 4, timeout: 30000 };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow(
      /tutorial never reached "drill-plan" — it is on "grid-select", live control grid-tool, after 4 tick\(s\); blocked by a pending event for 1 tick\(s\)/,
    );
  });

  // Issue #903: a held tutorial clock (TutorialRails.updateClock sets
  // isPaused and never releases it, e.g. the train-driller/train-digger
  // deadlock) used to look identical to an ordinary slow-progress stall —
  // the wait just kept looping `tick 1` (a no-op while genuinely paused,
  // since GameLoop.ts's own tick() returns early on state.isPaused) until
  // the outer maxTicks/timeout budget ran out, burning the scenario's whole
  // wall-clock allowance to report a plain "never reached" message with no
  // hint that the clock was the reason. Failing fast, by name, the moment
  // clockHeld has been observed for CLOCK_HELD_FAIL_AFTER_POLLS consecutive
  // polls turns that into an immediate, diagnostic failure instead.
  describe('waitForTutorialStep fails fast, by name, on a held clock instead of stalling out the full tick budget (#903)', () => {
    // Issue #908: a single held poll used to fail the wait outright, which
    // does not tolerate a MOMENTARY hold that clears on its own (e.g. a
    // one-frame pause while a modal opens) — only a SUSTAINED hold (held on
    // 2 consecutive polls) is a genuine deadlock. 2 is the smallest value
    // that gives the existing heldWithoutProgress reset-on-clean-poll
    // debounce counter any real effect.
    it('requires the hold to persist for 2 consecutive polls before treating it as sustained', () => {
      expect(CLOCK_HELD_FAIL_AFTER_POLLS).toBe(2);
    });

    it('throws a distinct "clock held" error once clockHeld has been observed true for CLOCK_HELD_FAIL_AFTER_POLLS consecutive polls, well before maxTicks is ever approached, and the message names the step, stage, live control and tick count', async () => {
      const evaluate = vi.fn().mockResolvedValue({
        active: true, stepId: 'train-driller', stageTarget: '.bs-train-btn', clockHeld: true, stageIndex: 2,
      });
      const page = fakePage({ evaluate });
      const step: ScenarioStepDef = { command: 'wait_for_tutorial_step step:buy-drill-rig-assign', role: 'setup' };
      const action = {
        type: 'waitForTutorialStep' as const, stepId: 'buy-drill-rig-assign', maxTicks: 3000, timeout: 30000,
      };

      const failure = await executeActionOnPage(page, action, step).then(
        () => null,
        (err: Error) => err,
      );

      expect(failure, 'waitForTutorialStep resolved instead of failing on a held clock').not.toBeNull();
      const message = failure!.message;
      // Full diagnosis, matching the level of detail the neighbouring
      // ordinary-timeout throw two lines below already gives: step id,
      // stage index, live control, and ticks used — not just "held".
      expect(message).toMatch(/train-driller/);
      expect(message).toMatch(/stage\s*2\b/i);
      expect(message).toMatch(/\.bs-train-btn/);
      expect(message).toMatch(/2 tick/i);
      expect(message).toMatch(/held/i);
      // A genuinely distinct failure mode, not the ordinary exhausted-budget
      // message with a suffix tacked on.
      expect(message).not.toMatch(/tutorial never reached/);
      // Fails on the threshold (2 consecutive held polls), not on the first
      // held poll, and not by looping all the way to maxTicks — exactly the
      // wall-clock cost this fix exists to avoid.
      expect(evaluate).toHaveBeenCalledTimes(2);
    });

    it('tolerates a MOMENTARY hold that clears within one poll of appearing, without failing the wait', async () => {
      const evaluate = vi.fn()
        // poll 1: held, but not yet the wanted step.
        .mockResolvedValueOnce({
          active: true, stepId: 'train-driller', stageTarget: '.bs-train-btn', clockHeld: true, stageIndex: 1,
        })
        // poll 2: hold has cleared on its own; still not the wanted step.
        .mockResolvedValueOnce({
          active: true, stepId: 'train-driller', stageTarget: '.bs-train-btn', clockHeld: false, stageIndex: 1,
        })
        // poll 3: wanted step reached.
        .mockResolvedValueOnce({
          active: true, stepId: 'buy-drill-rig-assign', stageTarget: '#bs-vehicle-panel', clockHeld: false, stageIndex: 2,
        });
      const page = fakePage({ evaluate });
      const step: ScenarioStepDef = { command: 'wait_for_tutorial_step step:buy-drill-rig-assign', role: 'setup' };
      const action = {
        type: 'waitForTutorialStep' as const, stepId: 'buy-drill-rig-assign', maxTicks: 3000, timeout: 30000,
      };

      await expect(executeActionOnPage(page, action, step)).resolves.toBeUndefined();
      // A hold that persisted only 1 poll before clearing must not have
      // fast-failed the wait — it keeps polling normally to the goal.
      expect(evaluate).toHaveBeenCalledTimes(3);
    });

    it('reports the state at the moment of failure — not the first poll\'s — when a sustained hold appears mid-wait rather than from poll 1', async () => {
      const evaluate = vi.fn()
        // poll 1: clean, not yet the wanted step.
        .mockResolvedValueOnce({
          active: true, stepId: 'grid-select', stageTarget: 'grid-tool', clockHeld: false, stageIndex: 0,
        })
        // poll 2: hold begins.
        .mockResolvedValueOnce({
          active: true, stepId: 'train-driller', stageTarget: '.bs-train-btn', clockHeld: true, stageIndex: 2,
        })
        // poll 3: 2nd consecutive held poll — sustained, must throw here,
        // diagnosing THIS poll's step/stage/control, not poll 1's.
        .mockResolvedValueOnce({
          active: true, stepId: 'train-digger', stageTarget: '.bs-dig-btn', clockHeld: true, stageIndex: 3,
        });
      const page = fakePage({ evaluate });
      const step: ScenarioStepDef = { command: 'wait_for_tutorial_step step:buy-drill-rig-assign', role: 'setup' };
      const action = {
        type: 'waitForTutorialStep' as const, stepId: 'buy-drill-rig-assign', maxTicks: 3000, timeout: 30000,
      };

      const failure = await executeActionOnPage(page, action, step).then(
        () => null,
        (err: Error) => err,
      );

      expect(failure, 'waitForTutorialStep resolved instead of failing on the sustained hold').not.toBeNull();
      const message = failure!.message;
      expect(message).toMatch(/train-digger/);
      expect(message).not.toMatch(/grid-select/);
      expect(message).toMatch(/stage\s*3\b/i);
      expect(message).toMatch(/\.bs-dig-btn/);
      expect(message).toMatch(/3 tick/i);
      expect(evaluate).toHaveBeenCalledTimes(3);
    });

    it('does not throw when the hold clears exactly on the poll the wanted step is reached, even after one prior held poll', async () => {
      const evaluate = vi.fn()
        // poll 1: held, not yet the wanted step — 1st consecutive held poll.
        .mockResolvedValueOnce({
          active: true, stepId: 'train-driller', stageTarget: '.bs-train-btn', clockHeld: true, stageIndex: 2,
        })
        // poll 2: hold clears AND the wanted step is reached in the same poll.
        .mockResolvedValueOnce({
          active: true, stepId: 'buy-drill-rig-assign', stageTarget: '#bs-vehicle-panel', clockHeld: false, stageIndex: 3,
        });
      const page = fakePage({ evaluate });
      const step: ScenarioStepDef = { command: 'wait_for_tutorial_step step:buy-drill-rig-assign', role: 'setup' };
      const action = {
        type: 'waitForTutorialStep' as const, stepId: 'buy-drill-rig-assign', maxTicks: 3000, timeout: 30000,
      };

      await expect(executeActionOnPage(page, action, step)).resolves.toBeUndefined();
      expect(evaluate).toHaveBeenCalledTimes(2);
    });

    it('does not throw the clock-held error when clockHeld is true on the exact same poll the wanted step is already reached', async () => {
      const evaluate = vi.fn().mockResolvedValueOnce({
        active: true, stepId: 'buy-drill-rig-assign', stageTarget: '#bs-vehicle-panel', clockHeld: true,
      });
      const page = fakePage({ evaluate });
      const step: ScenarioStepDef = { command: 'wait_for_tutorial_step step:buy-drill-rig-assign', role: 'setup' };
      const action = {
        type: 'waitForTutorialStep' as const, stepId: 'buy-drill-rig-assign', maxTicks: 3000, timeout: 30000,
      };

      await expect(executeActionOnPage(page, action, step)).resolves.toBeUndefined();
      expect(evaluate).toHaveBeenCalledTimes(1);
    });
  });
});

describe('executeActionOnPage — ensurePanel (PR #616 review round, item 7)', () => {
  it('does not click when __uiState() already reports the panel visible', async () => {
    // The mocked evaluate stands in for the whole page.evaluate(callback)
    // round trip — it returns what the real browser-side callback would
    // have computed (here, the extracted `visible` boolean), not the raw
    // __uiState() object the callback reads from inside the page.
    const evaluate = vi.fn().mockResolvedValueOnce(true);
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'employee hire role:driller', role: 'setup' };
    const action = { type: 'ensurePanel' as const, panel: 'employees' };

    await executeActionOnPage(page, action, step);

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(page.click).not.toHaveBeenCalled();
  });

  it('clicks the toolbar tab when __uiState() reports the panel not visible', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(null); // waitUsableAndClick's own probe: usable now
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'employee hire role:driller', role: 'setup' };
    const action = { type: 'ensurePanel' as const, panel: 'employees' };

    await executeActionOnPage(page, action, step);

    expect(page.click).toHaveBeenCalledWith('#bs-toolbar [data-panel="employees"]');
  });

  it('rejects an unknown/non-toggle panel name without touching the page', async () => {
    const page = fakePage();
    const step: ScenarioStepDef = { command: 'noop', role: 'setup' };
    const action = { type: 'ensurePanel' as const, panel: 'settings' };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow(/unknown panel "settings"/);
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});

describe('executeActionOnPage — ensureStep (PR #616 review round, item 7)', () => {
  it('does not click when __uiState().activeBlastStep already matches', async () => {
    // First resolved value stands for the panel-visibility read
    // (__uiState().panels['bs-blast-panel'].visible === true); the second
    // stands for the activeBlastStep read that follows it (#652).
    const evaluate = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(2);
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'charge hole:H1 explosive:boomite amount:5kg stemming:2m', role: 'setup' };
    const action = { type: 'ensureStep' as const, step: 2 as const };

    await executeActionOnPage(page, action, step);

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(page.click).not.toHaveBeenCalled();
  });

  it('clicks the step tab when __uiState().activeBlastStep does not match', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(true) // panel-visibility read: Blast panel open
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(null); // waitUsableAndClick's own probe: usable now
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'charge hole:H1 explosive:boomite amount:5kg stemming:2m', role: 'setup' };
    const action = { type: 'ensureStep' as const, step: 2 as const };

    await executeActionOnPage(page, action, step);

    expect(page.click).toHaveBeenCalledWith('#bs-blast-panel [data-step="2"]');
  });

  // Issue #652: ensureStep clicks the tab selector without ever checking
  // whether the Blast panel itself is open. With the panel closed, the tab
  // is display:none and waitUsableAndClick times out with a generic "control
  // not usable" message instead of naming the real cause. ensureStep must
  // read __uiState().panels['bs-blast-panel'].visible (via the module-scope
  // PANEL_ELEMENT_ID.blast) before its activeBlastStep check and reject with
  // a message naming ensurePanel({ panel: 'blast' }) as the fix, never
  // reaching the tab-click path.
  it('rejects naming ensurePanel when the Blast panel is not open, without ever clicking', async () => {
    const evaluate = vi.fn().mockResolvedValueOnce(false); // panel-visibility read: Blast panel closed
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'charge hole:H1 explosive:boomite amount:5kg stemming:2m', role: 'setup' };
    const action = { type: 'ensureStep' as const, step: 2 as const };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow(
      /ensureStep: the Blast panel is not open — call ensurePanel\(\{ panel: 'blast' \}\) first/,
    );
    expect(page.click).not.toHaveBeenCalled();
  });

  it('treats an undefined panels[\'bs-blast-panel\'] entry identically to visible: false', async () => {
    // __uiState() itself resolves, but the panels map has no entry at all for
    // the Blast panel id (e.g. before the panel has ever been mounted) —
    // must reject the same as an explicit `visible: false`, not throw a
    // different error or fall through to the tab-click path.
    const evaluate = vi.fn().mockResolvedValueOnce(undefined);
    const page = fakePage({ evaluate });
    const step: ScenarioStepDef = { command: 'charge hole:H1 explosive:boomite amount:5kg stemming:2m', role: 'setup' };
    const action = { type: 'ensureStep' as const, step: 2 as const };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow(
      /ensureStep: the Blast panel is not open — call ensurePanel\(\{ panel: 'blast' \}\) first/,
    );
    expect(page.click).not.toHaveBeenCalled();
  });
});

describe('describeStepFailure', () => {
  it('prefixes a player step\'s error with its label', () => {
    const step: ScenarioStepDef = { command: 'blast', description: 'fire the blast', role: 'player' };
    expect(describeStepFailure(step, new Error('boom'))).toBe(
      'player step "fire the blast" did not complete: boom',
    );
  });

  it('falls back to the command as the label when no description is set', () => {
    const step: ScenarioStepDef = { command: 'blast', role: 'player' };
    expect(describeStepFailure(step, new Error('boom'))).toBe(
      'player step "blast" did not complete: boom',
    );
  });

  it('leaves a setup step\'s error message unchanged', () => {
    const step: ScenarioStepDef = { command: 'new_game seed:1', role: 'setup' };
    expect(describeStepFailure(step, new Error('boom'))).toBe('boom');
  });

  it('leaves an unmarked (legacy) step\'s error message unchanged', () => {
    const step: ScenarioStepDef = { command: 'state' };
    expect(describeStepFailure(step, new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error throw', () => {
    const step: ScenarioStepDef = { command: 'blast', role: 'player' };
    expect(describeStepFailure(step, 'raw string throw')).toBe(
      'player step "blast" did not complete: raw string throw',
    );
  });
});

// Issue #699 — CI deterministically fails the `vibration-budget` interaction
// scenario: a `clickSelector` step throws "element is covered by div" because
// a timer/event overlay (`.bs-confirm-overlay`) can land in the real-time gap
// between a `resolveEventIfPending` action and the next `clickSelector`
// action. The fix extracts the pending-check + dialog-resolve logic already
// inline in `case 'resolveEventIfPending'` into a standalone
// `resolveEventIfPendingOnPage` helper, then has `clickSelector`'s own poll
// loop call it once as a last-resort retry when the deadline is reached and
// the last probed reason was `'covered'`.
describe('resolveEventIfPendingOnPage (issue #699)', () => {
  it('returns false promptly, touching the page exactly once, when no event is pending', async () => {
    const evaluate = vi.fn().mockResolvedValueOnce(false); // __gameState().pendingEvent -> false
    const page = fakePage({ evaluate });

    const resolved = await resolveEventIfPendingOnPage(page, 1000);

    expect(resolved).toBe(false);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(page.click).not.toHaveBeenCalled();
  });

  it('clicks the event dialog\'s choice (and dismiss, if present) and returns true when an event is genuinely pending', async () => {
    const evaluate = vi.fn()
      // __gameState().pendingEvent -> true
      .mockResolvedValueOnce(true)
      // __gameState().levelEndReason -> null (level still running)
      .mockResolvedValueOnce(false)
      // waitUsableAndClick's own __probeSelector poll for the choice button: usable immediately
      .mockResolvedValueOnce(null)
      // waitUsableAndClick's own __probeSelector poll for the dismiss button: usable immediately
      .mockResolvedValueOnce(null);
    const page = fakePage({ evaluate, click: vi.fn().mockResolvedValue(undefined) });

    const resolved = await resolveEventIfPendingOnPage(page, 8000);

    expect(resolved).toBe(true);
    expect(page.click).toHaveBeenCalledWith('#bs-event-dialog .bs-event-choice');
    expect(page.click).toHaveBeenCalledWith('#bs-event-dialog .bs-event-dismiss');
  });

  it('resolves via the console (not a dialog click) and returns true when the level has already ended', async () => {
    const evaluate = vi.fn()
      // __gameState().pendingEvent -> true
      .mockResolvedValueOnce(true)
      // __gameState().levelEndReason -> non-null (level already over)
      .mockResolvedValueOnce(true)
      // __gameConsole('event choose 0')
      .mockResolvedValueOnce(undefined);
    const page = fakePage({ evaluate });

    const resolved = await resolveEventIfPendingOnPage(page, 8000);

    expect(resolved).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(page.click).not.toHaveBeenCalled();
  });
});

describe('clickSelector retries once via resolveEventIfPendingOnPage when covered by a pending event (issue #699)', () => {
  it('resolves the click instead of throwing "element is covered by div" once the covering event dialog clears', async () => {
    const targetSelector = '#bs-vibration-panel .bs-vibration-confirm-btn';
    let targetCalls = 0;
    let zeroArgCalls = 0;
    let resolved = false;

    const evaluate = vi.fn(async (_fn: unknown, arg?: string) => {
      if (arg === targetSelector) {
        targetCalls++;
        // Once the internal retry has resolved the pending event, the
        // overlay is gone and the target is usable again.
        if (resolved) return null;
        if (targetCalls <= 2) return 'covered'; // still covered while polling
        // 3rd+ probe while still unresolved: this is inspectSelector's own
        // full report, read back right before the (today, unretried) throw.
        return {
          found: true,
          pointerEvents: 'auto',
          display: 'block',
          visibility: 'visible',
          disabled: false,
          width: 120,
          height: 32,
          matchCount: 1,
          covering: 'div.bs-confirm-overlay',
        };
      }
      if (arg === '#bs-event-dialog .bs-event-choice') return null;
      if (arg === '#bs-event-dialog .bs-event-dismiss') return null;
      if (arg === undefined) {
        zeroArgCalls++;
        // 1st zero-arg call: __gameState().pendingEvent -> true
        if (zeroArgCalls === 1) return true;
        // 2nd zero-arg call: __gameState().levelEndReason -> null (not
        // ended) — this is also the moment the covering overlay clears,
        // since it only happens once resolveEventIfPendingOnPage actually
        // ran and resolved the dialog.
        if (zeroArgCalls === 2) {
          resolved = true;
          return false;
        }
        return undefined;
      }
      return null;
    });
    const page = fakePage({ evaluate, click: vi.fn().mockResolvedValue(undefined) });
    const step: ScenarioStepDef = {
      command: 'event choose 0',
      description: 'confirm vibration fine dialog',
      role: 'player',
      interaction: [{ type: 'clickSelector', selector: targetSelector }],
    };
    // Short poll timeout so the covered-by-div deadline is reached quickly
    // (the poll loop's own retry interval is a fixed 150ms real-time sleep).
    const action = { type: 'clickSelector' as const, selector: targetSelector, timeout: 60 };

    await expect(executeActionOnPage(page, action, step)).resolves.toBeUndefined();
    expect(page.click).toHaveBeenCalledWith(targetSelector, { button: 'left' });
  });
});
