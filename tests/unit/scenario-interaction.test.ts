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
import { executeActionOnPage } from '../../scripts/shared/interaction-executor.js';
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
