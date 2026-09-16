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

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Page } from 'puppeteer';
import {
  executeActionOnPage, resolveEventIfPendingOnPage, CLOCK_HELD_FAIL_AFTER_POLLS,
  CLICK_SELECTOR_DEFAULT_TIMEOUT_MS,
  WAIT_UNTIL_TICK_BATCH,
} from '../../scripts/shared/interaction-executor.js';
import {
  CLICK_SELECTOR_ZERO_SIZE_GRACE_MS, CLICK_SELECTOR_ZERO_SIZE_CLICK_RETRIES,
} from '../../scripts/shared/click-retry.js';
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

describe('a control nothing renders is reported as never-appeared, not as a race (#929)', () => {
  // The two absent cases read identically in inspectSelector's report and
  // mean opposite things. #929 spent a CI cycle hunting a re-render race
  // because three scenario files clicked into a Fleet panel no step had
  // opened, and the never-rendered case was worded as a mid-click vanish.
  it('reports the selector as never appearing when every poll reads absent, without ever attempting a click', async () => {
    const selector = '#bs-vehicle-panel [data-vehicle-id="2"] .bsx-btn-danger';
    const evaluate = vi.fn()
      // __probeSelector: uiActionProbe returns 'absent' for a selector that
      // matches nothing, which is what an unopened panel's cards look like.
      .mockResolvedValueOnce('absent')
      // inspectSelector's report, read back once the deadline passes.
      .mockResolvedValueOnce({ found: false });
    const click = vi.fn();
    const page = fakePage({ evaluate, click });
    // A spent deadline, so exactly one poll happens and the two mocked
    // responses above line up with it — the wall-clock length of the wait is
    // not what this test is about.
    const action = { type: 'clickSelector' as const, selector, timeout: -1 };
    const step: ScenarioStepDef = {
      command: 'vehicle scrap 2',
      description: 'scrap the parked debris_hauler',
      role: 'player',
      interaction: [action],
    };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow(
      'element never appeared in the DOM',
    );
    expect(click).not.toHaveBeenCalled();
  });

  it('still reports a control that was usable and then disappeared under the click as vanished', async () => {
    const selector = '#bs-vehicle-panel [data-vehicle-id="2"] .bsx-btn-danger';
    const evaluate = vi.fn()
      .mockResolvedValueOnce(null) // probe: usable, so the click is attempted
      .mockResolvedValueOnce({ found: false }); // gone by the time it lands
    const page = fakePage({
      evaluate,
      click: vi.fn().mockRejectedValue(new Error('Node is either not clickable or not an Element')),
    });
    const action = { type: 'clickSelector' as const, selector };
    const step: ScenarioStepDef = {
      command: 'vehicle scrap 2',
      description: 'scrap the parked debris_hauler',
      role: 'player',
      interaction: [action],
    };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow(
      'element vanished from the DOM between the wait and the click',
    );
  });
});

describe('executeActionOnPage — waitUntil (issue #590, #601)', () => {
  // The wait's tick / read / auto-resolve / compare loop runs in the page,
  // up to WAIT_UNTIL_TICK_BATCH ticks per round trip. These run that very
  // page-side function against a stubbed window, so what they pin is the
  // loop the browser executes, not a canned answer per round trip.
  afterEach(() => { vi.unstubAllGlobals(); });

  function stubGame(holeCountAfter: (ticks: number) => number, pendingEventAt = -1) {
    let ticks = 0;
    const gameConsole = vi.fn((cmd: string) => {
      if (cmd === 'tick 1') ticks++;
      return { output: '' };
    });
    const gameState = vi.fn(() => ({
      holeCount: holeCountAfter(ticks),
      tickCount: ticks,
      pendingEvent: ticks === pendingEventAt,
    }));
    vi.stubGlobal('window', { __gameConsole: gameConsole, __gameState: gameState });
    const evaluate = vi.fn(async (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => fn(...args));
    return { gameConsole, evaluate, ticksIssued: () => ticks };
  }
  const step: ScenarioStepDef = { command: 'wait_until field:holeCount equals:25 max_ticks:400', role: 'setup' };

  it('resolves once the polled field reaches the target, looping the console\'s own deterministic tick 1 in one round trip', async () => {
    // #601: the page loops `tick 1` + state read + conditional resolve +
    // field read itself — no real-time auto-tick toggling any more — and
    // reports back once, when the field matches or the batch is spent.
    const { gameConsole, evaluate, ticksIssued } = stubGame(ticks => [0, 3, 9, 25][ticks] ?? 25);
    const page = fakePage({ evaluate });
    const action = { type: 'waitUntil' as const, field: 'holeCount', equals: 25, maxTicks: 400, timeoutMs: 30000 };

    await executeActionOnPage(page, action, step);

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(ticksIssued()).toBe(3);
    expect(gameConsole).not.toHaveBeenCalledWith('event choose 0');
  });

  it('auto-resolves a pending event right after the tick that raised it, inside the same round trip', async () => {
    const { gameConsole, evaluate } = stubGame(ticks => (ticks >= 3 ? 25 : 0), 2);
    const page = fakePage({ evaluate });
    const action = { type: 'waitUntil' as const, field: 'holeCount', equals: 25, maxTicks: 400, timeoutMs: 30000 };

    await executeActionOnPage(page, action, step);

    expect(gameConsole.mock.calls.map(([cmd]) => cmd)).toEqual(['tick 1', 'tick 1', 'event choose 0', 'tick 1']);
  });

  it('exhausts its tick budget and throws naming the field, its last value, and the tick count', async () => {
    const { evaluate, ticksIssued } = stubGame(() => 3);
    const page = fakePage({ evaluate });
    const action = { type: 'waitUntil' as const, field: 'holeCount', equals: 25, maxTicks: 1, timeoutMs: 30000 };

    await expect(executeActionOnPage(page, action, { ...step, command: 'wait_until field:holeCount equals:25 max_ticks:1' })).rejects.toThrow(
      /"holeCount" never reached 25 — stalled at 3 after 1 tick\(s\)/,
    );
    expect(ticksIssued()).toBe(1);
  });

  it('never ticks past maxTicks: a budget larger than one batch is spent in bounded round trips', async () => {
    const { evaluate, ticksIssued } = stubGame(() => 3);
    const page = fakePage({ evaluate });
    const maxTicks = WAIT_UNTIL_TICK_BATCH * 2 + 50;
    const action = { type: 'waitUntil' as const, field: 'holeCount', equals: 25, maxTicks, timeoutMs: 30000 };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow(
      new RegExp(`stalled at 3 after ${maxTicks} tick\\(s\\)`),
    );
    expect(ticksIssued()).toBe(maxTicks);
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  // Item 5 of the PR #616 review round: a step that times out on the outer
  // deadline (several actions' combined time, none individually stalling)
  // should still name the field/value/tick-count the runner last observed
  // through waitUntil, instead of a bare "Step N timed out after Xms".
  it('reports its field/value/tick-count after every round trip via onProgress', async () => {
    const { evaluate } = stubGame(ticks => (ticks >= WAIT_UNTIL_TICK_BATCH + 20 ? 25 : 9));
    const page = fakePage({ evaluate });
    const action = { type: 'waitUntil' as const, field: 'holeCount', equals: 25, maxTicks: 400, timeoutMs: 30000 };
    const progress: string[] = [];

    await executeActionOnPage(page, action, step, (detail) => progress.push(detail));

    expect(progress).toEqual([
      `waitUntil "holeCount" = 9 (want 25), tick ${WAIT_UNTIL_TICK_BATCH}/400`,
      `waitUntil "holeCount" = 25 (want 25), tick ${WAIT_UNTIL_TICK_BATCH + 20}/400`,
    ]);
  });

  it('keeps one round trip per tick when a trace sink is attached, so the trace names every tick', async () => {
    // compare-scenario-traces.ts (#674) lines the two modes up tick by tick,
    // and needs each tick reported on its own — the batch is for the
    // untraced batch runner only.
    const { evaluate } = stubGame(ticks => [0, 3, 9, 25][ticks] ?? 25);
    const page = fakePage({ evaluate });
    const action = { type: 'waitUntil' as const, field: 'holeCount', equals: 25, maxTicks: 400, timeoutMs: 30000 };
    const trace: unknown[] = [];

    await executeActionOnPage(page, action, step, undefined, (entry) => trace.push(entry));

    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(trace).toEqual([
      { command: 'tick 1', success: true, tickCountAfter: 1 },
      { command: 'tick 1', success: true, tickCountAfter: 2 },
      { command: 'tick 1', success: true, tickCountAfter: 3 },
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

    expect(page.click).toHaveBeenCalledWith('#bs-toolbar [data-panel="employees"]', { button: 'left' });
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

    expect(page.click).toHaveBeenCalledWith('#bs-blast-panel [data-step="2"]', { button: 'left' });
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
    expect(page.click).toHaveBeenCalledWith('#bs-event-dialog .bs-event-choice', { button: 'left' });
    expect(page.click).toHaveBeenCalledWith('#bs-event-dialog .bs-event-dismiss', { button: 'left' });
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

// Issue #1032 — CI has flaked on `sandbox-mode.json` because a modal opened
// while a heavy render/animation plays can still be zero-size at the
// CLICK_SELECTOR_DEFAULT_TIMEOUT_MS mark on a slow/CPU-starved runner, yet
// become usable moments later. clickSelector must grant one extra
// CLICK_SELECTOR_ZERO_SIZE_GRACE_MS window instead of throwing immediately,
// but only when the most recently polled reason is exactly 'zero-size', and
// only once. Every other blocked reason (and a second zero-size timeout)
// must still fail exactly as before.
//
// Date.now() is stubbed so these tests don't pay CLICK_SELECTOR_ZERO_SIZE_
// GRACE_MS (10s) of real wall-clock time — the poll loop's own 150ms
// real-time sleep between iterations still runs for real, but only a
// handful of iterations are ever needed since the mocked clock, not the
// sleep, is what the loop's deadline math reads.
describe('clickSelector — zero-size grace extension (issue #1032)', () => {
  const selector = '#bs-blast-report-modal .bs-blast-report-close';

  /** A well-formed inspectSelector() report for a control that is attached,
   * unblocked, but has never laid out. */
  function zeroSizeReport() {
    return {
      found: true,
      pointerEvents: 'auto',
      display: 'block',
      visibility: 'visible',
      disabled: false,
      width: 0,
      height: 0,
      matchCount: 1,
    };
  }

  /**
   * Builds a `page.evaluate` mock that dispatches on the *callback source*
   * rather than call order: the probe callback (clickSelector's own poll)
   * references `__probeSelector`, inspectSelector's does not. Called-order
   * dispatch (a plain `mockResolvedValueOnce` chain) breaks here because
   * today's (pre-#1032) code and the grace-extended code-to-be reach
   * `inspectSelector` after a *different* number of probe polls — the same
   * scripted sequence has to serve both without assuming which one is
   * running. Each entry in `script` answers one probe poll in order; the
   * last entry repeats for any extra poll beyond the scripted ones. Every
   * non-probe call (i.e. inspectSelector, on the throw path) gets a
   * well-formed zero-size report instead of risking mock-exhaustion
   * `undefined` and an incidental `TypeError` unrelated to the behaviour
   * under test.
   */
  function makeProbeEvaluate(script: Array<() => string | null>) {
    let i = 0;
    return vi.fn(async (fn: unknown) => {
      if (String(fn).includes('__probeSelector')) {
        const step = script[Math.min(i, script.length - 1)]!; // index is always clamped within bounds by Math.min
        i += 1;
        return step();
      }
      return zeroSizeReport();
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extends the deadline once instead of throwing when zero-size persists past the default timeout, and clicks through once the control lays out inside the grace window', async () => {
    let simulatedNow = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => simulatedNow);

    const evaluate = makeProbeEvaluate([
      // 1st poll: comfortably inside the default budget, still zero-size.
      () => { simulatedNow = 100; return 'zero-size'; },
      // 2nd poll: strictly past CLICK_SELECTOR_DEFAULT_TIMEOUT_MS, and the
      // modal is *still* zero-size — this is the moment grace, not a
      // throw, must be granted.
      () => { simulatedNow = CLICK_SELECTOR_DEFAULT_TIMEOUT_MS + 100; return 'zero-size'; },
      // 3rd poll: well inside the extended (grace) deadline, and the
      // modal has finally laid out — the click must proceed.
      () => { simulatedNow += 100; return null; },
    ]);
    const page = fakePage({ evaluate, click: vi.fn().mockResolvedValue(undefined) });
    const action = { type: 'clickSelector' as const, selector };
    const step: ScenarioStepDef = {
      command: 'blast_report close',
      description: 'close the blast report modal',
      role: 'player',
      interaction: [action],
    };

    await expect(executeActionOnPage(page, action, step)).resolves.toBeUndefined();
    expect(page.click).toHaveBeenCalledWith(selector, { button: 'left' });
  });

  it('grants the zero-size grace exactly once — still zero-size at the extended deadline throws with a loud, specific diagnosis', async () => {
    let simulatedNow = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => simulatedNow);

    const evaluate = makeProbeEvaluate([
      // 1st poll: already past the default timeout — grace must be
      // granted.
      () => { simulatedNow = CLICK_SELECTOR_DEFAULT_TIMEOUT_MS + 100; return 'zero-size'; },
      // 2nd poll: comfortably past the *extended* (grace) deadline too,
      // and still zero-size — a second grace must never be granted, so
      // this must throw.
      () => {
        simulatedNow = CLICK_SELECTOR_DEFAULT_TIMEOUT_MS + CLICK_SELECTOR_ZERO_SIZE_GRACE_MS + 1000;
        return 'zero-size';
      },
    ]);
    const page = fakePage({ evaluate });
    const action = { type: 'clickSelector' as const, selector };
    const step: ScenarioStepDef = {
      command: 'blast_report close',
      description: 'close the blast report modal',
      role: 'player',
      interaction: [action],
    };

    let caught: unknown;
    try {
      await executeActionOnPage(page, action, step);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(selector);
    // Substantive content rather than an exact string (brittle against the
    // implementer's exact wording): communicates the control was attached
    // and unblocked but never gained a layout box, distinguishing this from
    // the plain "element has zero size (0x0)" every other reason keeps.
    expect(message).toMatch(/layout|dimensions|laid out|never (gained|got)/i);
    // ...and communicates timing (how long it waited in total), not just
    // the bare fact of a timeout.
    expect(message).toMatch(/wait(ed)?|timeout|\d+\s*ms/i);
  });

  it('never grants grace for a non-zero-size blocked reason (e.g. disabled) — throws at the unchanged default timeout with the unchanged message', async () => {
    // No Date.now stub here: action.timeout:-1 (same degenerate value the
    // #929 "never appeared" tests above use) forces the very first poll's
    // deadline check to already be in the past, so exactly one probe + one
    // inspectSelector call happen regardless of wall-clock timing.
    const evaluate = vi.fn()
      .mockResolvedValueOnce('disabled')
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
    const click = vi.fn();
    const page = fakePage({ evaluate, click });
    const action = { type: 'clickSelector' as const, selector, timeout: -1 };
    const step: ScenarioStepDef = {
      command: 'blast_report close',
      description: 'close the blast report modal',
      role: 'player',
      interaction: [action],
    };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow('element is disabled');
    expect(click).not.toHaveBeenCalled();
    // Exactly one probe + one inspectSelector call: no extra poll iteration
    // was spent trying (and failing) to grant a grace this reason never
    // qualifies for.
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('edge case: grants the zero-size grace even when action.timeout is already expired at the very first poll (timeout:-1)', async () => {
    let simulatedNow = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => simulatedNow);

    const evaluate = makeProbeEvaluate([
      // 1st poll: the deadline (Date.now() + (-1)) is already in the past
      // the instant it's computed, so this single reading is what an
      // unmodified poll loop treats as "timed out" — and it reads
      // zero-size.
      () => { simulatedNow = 1; return 'zero-size'; },
      // 2nd poll: usable moments later, comfortably inside the grace
      // window (CLICK_SELECTOR_ZERO_SIZE_GRACE_MS is 10s; this is 1ms
      // later).
      () => { simulatedNow = 2; return null; },
    ]);
    const page = fakePage({ evaluate, click: vi.fn().mockResolvedValue(undefined) });
    const action = { type: 'clickSelector' as const, selector, timeout: -1 };
    const step: ScenarioStepDef = {
      command: 'blast_report close',
      description: 'close the blast report modal',
      role: 'player',
      interaction: [action],
    };

    await expect(executeActionOnPage(page, action, step)).resolves.toBeUndefined();
    expect(page.click).toHaveBeenCalledWith(selector, { button: 'left' });
  });

  // Edge case per the plan: a control that goes 'covered' first (triggering
  // the existing #699 one-time covered-retry via resolveEventIfPendingOnPage)
  // and *then* transitions to 'zero-size' before the extended covered
  // deadline, confirming the two one-time grace mechanisms are independent.
  // Not written here: the #699 retry path is itself driven by a second,
  // real async subsystem (resolveEventIfPendingOnPage's own page.evaluate
  // calls, interleaved with the zero-size poll's), and scripting a
  // deterministic sequence across both against an interaction-executor.ts
  // that does not yet implement the zero-size half would mean guessing the
  // implementer's call ordering rather than pinning observable behaviour —
  // exactly the brittleness the plan warns against. Once the implementation
  // exists, this interaction is worth covering for real.

  // Issue #1109 CI-fix — sandbox-mode's report-close failed on CI (and,
  // reproduced locally, 1/3 runs) with the bare "element has zero size
  // (0x0)" message, no grace context, even though PR #1037's grace already
  // exists. Diagnosis: BlastReportModal's overlay toggles `display` from
  // 'none' to '' only once its deferred open fires (BLAST_REPORT_DELAY_MS
  // plus collapse-playback duration), so the poll's last-read reason at the
  // CLICK_SELECTOR_DEFAULT_TIMEOUT_MS deadline is 'hidden', not 'zero-size'
  // — the original grace condition only checked the latter, so it never
  // engaged, and the loop threw immediately even though the control was
  // about to open moments later (measured locally at ~5.0-5.13s against a
  // 5s default budget). 'hidden' now earns the same one-time grace
  // 'zero-size' already had.
  it('extends the deadline once instead of throwing when hidden persists past the default timeout, and clicks through once the control becomes visible inside the grace window (#1109)', async () => {
    let simulatedNow = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => simulatedNow);

    const evaluate = makeProbeEvaluate([
      // 1st poll: comfortably inside the default budget, still hidden (the
      // report modal's overlay has not toggled display yet).
      () => { simulatedNow = 100; return 'hidden'; },
      // 2nd poll: strictly past CLICK_SELECTOR_DEFAULT_TIMEOUT_MS, and
      // still hidden — this is the moment grace, not a throw, must be
      // granted.
      () => { simulatedNow = CLICK_SELECTOR_DEFAULT_TIMEOUT_MS + 100; return 'hidden'; },
      // 3rd poll: well inside the extended (grace) deadline, and the modal
      // has finally opened and laid out — the click must proceed.
      () => { simulatedNow += 100; return null; },
    ]);
    const page = fakePage({ evaluate, click: vi.fn().mockResolvedValue(undefined) });
    const action = { type: 'clickSelector' as const, selector };
    const step: ScenarioStepDef = {
      command: 'blast',
      description: 'close the blast report modal',
      role: 'player',
      interaction: [action],
    };

    await expect(executeActionOnPage(page, action, step)).resolves.toBeUndefined();
    expect(page.click).toHaveBeenCalledWith(selector, { button: 'left' });
  });

  it('grants the hidden grace exactly once — still hidden at the extended deadline throws with a loud, specific diagnosis (#1109)', async () => {
    let simulatedNow = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => simulatedNow);

    const evaluate = makeProbeEvaluate([
      // 1st poll: already past the default timeout — grace must be
      // granted.
      () => { simulatedNow = CLICK_SELECTOR_DEFAULT_TIMEOUT_MS + 100; return 'hidden'; },
      // 2nd poll: comfortably past the *extended* (grace) deadline too, and
      // still hidden — a second grace must never be granted, so this must
      // throw.
      () => {
        simulatedNow = CLICK_SELECTOR_DEFAULT_TIMEOUT_MS + CLICK_SELECTOR_ZERO_SIZE_GRACE_MS + 1000;
        return 'hidden';
      },
    ]);
    const page = fakePage({ evaluate });
    const action = { type: 'clickSelector' as const, selector };
    const step: ScenarioStepDef = {
      command: 'blast',
      description: 'close the blast report modal',
      role: 'player',
      interaction: [action],
    };

    let caught: unknown;
    try {
      await executeActionOnPage(page, action, step);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(selector);
    // The grace-diagnosis phrasing, same as the zero-size case — proves the
    // 'hidden' reason is now built from the same single fresh read that
    // decided the grace, rather than reading back the bare "zero size"
    // message a separate, later inspectSelector() call would race into.
    expect(message).toMatch(/layout|dimensions|laid out|never (gained|got)/i);
    expect(message).toMatch(/wait(ed)?|timeout|\d+\s*ms/i);
  });

  it('regression: no wasted poll iteration when the control is usable well before the default timeout (the common case)', async () => {
    const evaluate = vi.fn().mockResolvedValueOnce(null); // usable on the very first probe
    const click = vi.fn().mockResolvedValue(undefined);
    const page = fakePage({ evaluate, click });
    const action = { type: 'clickSelector' as const, selector };
    const step: ScenarioStepDef = {
      command: 'blast_report close',
      description: 'close the blast report modal',
      role: 'player',
      interaction: [action],
    };

    await expect(executeActionOnPage(page, action, step)).resolves.toBeUndefined();
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledWith(selector, { button: 'left' });
  });
});

// Issue #1053 CI-fix (CI run 34690787172) — sandbox-mode.json's report-close
// click failed as bare "element has zero size (0x0)", not the #1032 grace's
// "...after waiting Xms" phrasing. That message shape only comes from the
// post-probe page.click() catch, not the poll loop's own deadline branch:
// the probe had already called the control usable (broke out of the poll),
// and the real click() failed a beat later on a heavily loaded runner — a
// narrower gap than #1032's grace (which only extends the wait *before* the
// click) reaches. CLICK_SELECTOR_ZERO_SIZE_CLICK_RETRIES closes it by
// retrying the click itself, bounded, and only for a zero-size readback.
describe('clickSelector — retries a stale zero-size click failure (issue #1053 CI-fix)', () => {
  const selector = '[data-action="report-close"]';

  it('retries the click once a stale zero-size readback resolves, without re-polling the probe', async () => {
    const evaluate = vi.fn()
      // __probeSelector: usable, so the loop proceeds straight to the click.
      .mockResolvedValueOnce(null)
      // inspectSelector after the first page.click() rejects: still attached
      // and unblocked, but no layout box yet.
      .mockResolvedValueOnce({
        found: true,
        pointerEvents: 'auto',
        display: 'block',
        visibility: 'visible',
        disabled: false,
        width: 0,
        height: 0,
        matchCount: 1,
      });
    const click = vi.fn()
      .mockRejectedValueOnce(new Error('Node is either not clickable or not an Element'))
      .mockResolvedValueOnce(undefined);
    const page = fakePage({ evaluate, click });
    const action = { type: 'clickSelector' as const, selector };
    const step: ScenarioStepDef = {
      command: 'blast',
      description: 'blast complete',
      role: 'player',
      interaction: [action],
    };

    await expect(executeActionOnPage(page, action, step)).resolves.toBeUndefined();
    expect(click).toHaveBeenCalledTimes(2);
    // No extra probe poll — the retry re-attempts the click directly, it
    // does not re-run the usable-wait loop.
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('gives up after CLICK_SELECTOR_ZERO_SIZE_CLICK_RETRIES attempts still reading zero-size, throwing the bare zero-size message (not the #1032 grace phrasing)', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(null) // probe: usable
      .mockResolvedValue({
        found: true,
        pointerEvents: 'auto',
        display: 'block',
        visibility: 'visible',
        disabled: false,
        width: 0,
        height: 0,
        matchCount: 1,
      });
    const click = vi.fn().mockRejectedValue(new Error('Node is either not clickable or not an Element'));
    const page = fakePage({ evaluate, click });
    const action = { type: 'clickSelector' as const, selector };
    const step: ScenarioStepDef = {
      command: 'blast',
      description: 'blast complete',
      role: 'player',
      interaction: [action],
    };

    let caught: unknown;
    try {
      await executeActionOnPage(page, action, step);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(selector);
    expect(message).toContain('element has zero size (0x0)');
    expect(click).toHaveBeenCalledTimes(CLICK_SELECTOR_ZERO_SIZE_CLICK_RETRIES);
  });

  it('never retries a click failure for a reason other than zero-size (e.g. vanished) — fails on the very first attempt', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(null) // probe: usable, so the click is attempted
      .mockResolvedValueOnce({ found: false }); // gone by the time it lands
    const click = vi.fn().mockRejectedValue(new Error('Node is either not clickable or not an Element'));
    const page = fakePage({ evaluate, click });
    const action = { type: 'clickSelector' as const, selector };
    const step: ScenarioStepDef = {
      command: 'blast',
      description: 'blast complete',
      role: 'player',
      interaction: [action],
    };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow(
      'element vanished from the DOM between the wait and the click',
    );
    expect(click).toHaveBeenCalledTimes(1);
  });

  // #1045 CI-fix (CI run 34720642781) — the same sandbox-mode report-close
  // control failed a beat later than #1053's case: present, correctly sized,
  // uncovered, everything a real player-facing block would show absent —
  // and Puppeteer's click() still refused it. The retry above only covered
  // a zero-size readback; this is the same race a beat further along
  // whatever CSS transition the modal runs on open.
  it('retries a click failure that reads back as fully clickable (present, sized, uncovered) — not just zero-size', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(null) // probe: usable, so the loop proceeds straight to the click
      .mockResolvedValueOnce({
        found: true,
        pointerEvents: 'auto',
        display: 'block',
        visibility: 'visible',
        disabled: false,
        width: 84,
        height: 32,
        matchCount: 1,
      });
    const click = vi.fn()
      .mockRejectedValueOnce(new Error('Node is either not clickable or not an Element'))
      .mockResolvedValueOnce(undefined);
    const page = fakePage({ evaluate, click });
    const action = { type: 'clickSelector' as const, selector };
    const step: ScenarioStepDef = {
      command: 'blast',
      description: 'blast complete',
      role: 'player',
      interaction: [action],
    };

    await expect(executeActionOnPage(page, action, step)).resolves.toBeUndefined();
    expect(click).toHaveBeenCalledTimes(2);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('never retries a click failure the inspection reports as a real block (covered by another element) despite being found and sized', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce(null) // probe: usable, so the click is attempted
      .mockResolvedValueOnce({
        found: true,
        pointerEvents: 'auto',
        display: 'block',
        visibility: 'visible',
        disabled: false,
        width: 84,
        height: 32,
        matchCount: 1,
        covering: 'div.bs-modal-backdrop',
      });
    const click = vi.fn().mockRejectedValue(new Error('Node is either not clickable or not an Element'));
    const page = fakePage({ evaluate, click });
    const action = { type: 'clickSelector' as const, selector };
    const step: ScenarioStepDef = {
      command: 'blast',
      description: 'blast complete',
      role: 'player',
      interaction: [action],
    };

    await expect(executeActionOnPage(page, action, step)).rejects.toThrow(
      'element is covered by div.bs-modal-backdrop',
    );
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe('executeActionOnPage — clickIfPresent retries a re-rendered control (PR #1080 shard 5)', () => {
  it('clicks again when the first click lands on a node the panel just replaced', async () => {
    // blast-visual-full's per-hole charge step: `[data-hole="H1"]
    // [data-action="charge-hole"]` is rebuilt by ChargeHoleList on the
    // update after the amount stepper moved, and the click issued right
    // after that read Puppeteer's raw "Node is detached from document" —
    // twice on CI. The refreshed selector resolves to the replacement row,
    // which inspects as found/visible/uncovered, so the click is retried.
    const evaluate = vi.fn(async (fn: unknown) => {
      const src = String(fn);
      if (src.includes('__probeSelector')) return true;   // clickIfPresent's own usable probe
      if (src.includes('getBoundingClientRect')) {
        return { found: true, pointerEvents: 'auto', display: 'block', visibility: 'visible', disabled: false, width: 40, height: 18, matchCount: 1 };
      }
      return null;
    });
    let detachedOnce = false;
    const click = vi.fn(async () => {
      if (!detachedOnce) { detachedOnce = true; throw new Error('Node is detached from document'); }
    });
    const page = fakePage({ evaluate, click });
    const step: ScenarioStepDef = {
      command: 'charge hole:H1 explosive:boomite amount:8 stemming:3',
      role: 'player',
      interaction: [{ type: 'clickIfPresent', selector: '#bs-blast-panel [data-hole="H1"] [data-action="charge-hole"]' }],
    };
    await executeActionOnPage(page, step.interaction![0]!, step);
    expect(click).toHaveBeenCalledTimes(2);
  });
});

describe('executeActionOnPage — setStepper (PR #1070 shard 1, #1072)', () => {
  // A fake stepper: `evaluate` answers the usability probe with "usable" and
  // the value read with the current display text; `click` moves the value
  // by one step in the direction of the button clicked, clamped like the
  // real controls are. Shape-based dispatch on the evaluated function's
  // source rather than a once-sequence, because the loop's length is the
  // thing under test.
  function fakeStepper(opts: { start: number; step: number; unit: string; min?: number; max?: number; decimals?: number }) {
    const state = { value: opts.start, clicks: 0 };
    const render = () => `${opts.decimals === undefined ? state.value : state.value.toFixed(opts.decimals)} ${opts.unit}`;
    const evaluate = vi.fn(async (fn: unknown) => {
      const src = String(fn);
      if (src.includes('__probeSelector')) return null;
      if (src.includes('textContent')) return render();
      return null;
    });
    const click = vi.fn(async (selector: string) => {
      state.clicks += 1;
      const delta = selector.endsWith(':last-child') ? opts.step : -opts.step;
      const next = +(state.value + delta).toFixed(6);
      state.value = Math.max(opts.min ?? -Infinity, Math.min(opts.max ?? Infinity, next));
    });
    return { page: fakePage({ evaluate, click }), state, click };
  }

  const step: ScenarioStepDef = {
    command: 'charge hole:* explosive:boomite amount:8 stemming:2',
    role: 'player',
    interaction: [{ type: 'setStepper', selector: '#bs-blast-panel [data-field="amount"]', value: 8 }],
  };

  it('clicks + until the displayed value reads the target', async () => {
    const { page, state, click } = fakeStepper({ start: 5, step: 1, unit: 'kg' });
    await executeActionOnPage(page, { type: 'setStepper', selector: '#bs-blast-panel [data-field="amount"]', value: 8 }, step);
    expect(state.value).toBe(8);
    expect(click).toHaveBeenCalledTimes(3);
    for (const [sel] of click.mock.calls) expect(sel).toBe('#bs-blast-panel [data-field="amount"] .bsx-stepper-btn:last-child');
  });

  it('clicks - when the target is below the current value', async () => {
    const { page, state, click } = fakeStepper({ start: 5, step: 1, unit: 'kg' });
    await executeActionOnPage(page, { type: 'setStepper', selector: '#bs-blast-panel [data-field="amount"]', value: 2 }, step);
    expect(state.value).toBe(2);
    expect(click).toHaveBeenCalledTimes(3);
    for (const [sel] of click.mock.calls) expect(sel).toBe('#bs-blast-panel [data-field="amount"] .bsx-stepper-btn:first-child');
  });

  it('does not click at all when the value already matches', async () => {
    const { page, click } = fakeStepper({ start: 8, step: 1, unit: 'kg' });
    await executeActionOnPage(page, { type: 'setStepper', selector: '#bs-blast-panel [data-field="amount"]', value: 8 }, step);
    expect(click).not.toHaveBeenCalled();
  });

  it('matches a toFixed(1) display against an integer target and survives float steps', async () => {
    // Stemming steps by 0.2 and renders `2.0 m`: five clicks from 1.0 land
    // on 2.0000000000000004 in plain arithmetic, which must read as done.
    const { page, state, click } = fakeStepper({ start: 1, step: 0.2, unit: 'm', decimals: 1 });
    await executeActionOnPage(page, { type: 'setStepper', selector: '#bs-blast-panel [data-field="stemming"]', value: 2 }, step);
    expect(state.value).toBeCloseTo(2, 6);
    expect(click).toHaveBeenCalledTimes(5);
  });

  it('fails by name when the control clamps before the target, instead of spinning', async () => {
    const { page, click } = fakeStepper({ start: 18, step: 1, unit: 'm', max: 20 });
    await expect(
      executeActionOnPage(page, { type: 'setStepper', selector: '#bs-param-strip [data-field="spacing"]', value: 25 }, step),
    ).rejects.toThrow(/\+ button no longer moves the value \(clamped at 20\), wanted 25/);
    // 18→19, 19→20, then one click that changes nothing — and stops there.
    expect(click).toHaveBeenCalledTimes(3);
  });

  it('names a target the stepper cannot land on instead of oscillating around it', async () => {
    // tutorial-interactive.json's original shape: stemming declared 2.5 on a
    // 0.2 m stepper that starts at 2.0. The old click-count form silently
    // produced 2.4; this must fail by name on the first crossing, not spin
    // 2.4 → 2.6 → 2.4 until maxClicks.
    const { page, click } = fakeStepper({ start: 2, step: 0.2, unit: 'm', decimals: 1 });
    await expect(
      executeActionOnPage(page, { type: 'setStepper', selector: '#bs-blast-panel [data-field="stemming"]', value: 2.5 }, step),
    ).rejects.toThrow(/2\.5 is not a value this stepper can reach — one click moves it from 2\.4 to 2\.6/);
    // 2.0 → 2.2 → 2.4 → 2.6 (crossed): three clicks, then stop.
    expect(click).toHaveBeenCalledTimes(3);
  });

  it('retries a click the panel re-rendered out from under it, like clickSelector does', async () => {
    // PR #1080's first CI run: blast-visual-full's per-hole charge step died
    // on Puppeteer's "Node is detached from document" — the Charge panel
    // re-rendered its stepper between the usability probe and the click.
    // setStepper drives its buttons through clickSelector's own path, whose
    // retry treats a found/visible/uncovered node that still refused the
    // click as transient, so one detached click costs a retry, not the step.
    const state = { value: 5, clicks: 0, detachedOnce: false };
    const evaluate = vi.fn(async (fn: unknown) => {
      const src = String(fn);
      if (src.includes('__probeSelector')) return null;
      if (src.includes('textContent')) return `${state.value} kg`;
      if (src.includes('getBoundingClientRect')) {
        // inspectSelector's report for the re-rendered node: attached, sized, clickable.
        return { found: true, pointerEvents: 'auto', display: 'block', visibility: 'visible', disabled: false, width: 20, height: 20, matchCount: 1 };
      }
      return null;
    });
    const click = vi.fn(async (selector: string) => {
      state.clicks += 1;
      if (!state.detachedOnce) { state.detachedOnce = true; throw new Error('Node is detached from document'); }
      state.value += selector.endsWith(':last-child') ? 1 : -1;
    });
    const page = fakePage({ evaluate, click });
    await executeActionOnPage(page, { type: 'setStepper', selector: '#bs-blast-panel [data-field="amount"]', value: 6 }, step);
    expect(state.value).toBe(6);
    // One refused click, one retry that landed.
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('honours maxClicks as an outer bound and names what it still read', async () => {
    const { page } = fakeStepper({ start: 0, step: 1, unit: 'kg' });
    await expect(
      executeActionOnPage(page, { type: 'setStepper', selector: '#bs-blast-panel [data-field="amount"]', value: 10, maxClicks: 3 }, step),
    ).rejects.toThrow(/still reads 3 after 3 click\(s\), wanted 10/);
  });

  it('fails by name when the container has no stepper value to read', async () => {
    const evaluate = vi.fn(async (fn: unknown) => {
      const src = String(fn);
      if (src.includes('textContent')) return null;
      // inspectSelector's report for the diagnosis in the message.
      return { found: false, pointerEvents: '', display: '', visibility: '', disabled: false, width: 0, height: 0, matchCount: 0 };
    });
    const page = fakePage({ evaluate });
    await expect(
      executeActionOnPage(page, { type: 'setStepper', selector: '#bs-nowhere [data-field="amount"]', value: 3 }, step),
    ).rejects.toThrow(/no \.bsx-stepper-value found/);
  });

  it('fails by name when the displayed value is not a number', async () => {
    const evaluate = vi.fn(async (fn: unknown) => (String(fn).includes('textContent') ? '—' : null));
    const page = fakePage({ evaluate });
    await expect(
      executeActionOnPage(page, { type: 'setStepper', selector: '#bs-blast-panel [data-field="amount"]', value: 3 }, step),
    ).rejects.toThrow(/stepper value "—" is not a number/);
  });
});
