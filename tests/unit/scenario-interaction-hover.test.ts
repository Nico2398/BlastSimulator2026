// BlastSimulator2026 — hoverSelector player action (issue #2188)
//
// Hover-only UI (the `explainable()` stat tooltip) could not be screenshotted
// by a player step: nothing moved the real pointer onto a control. These
// tests cover the action's contract: wait on the same usability gate as
// `clickSelector`, hover with the real mouse, fail loudly and by name when the
// target is unreachable, retry a transient refusal, and settle the UI after.
//
// `Page` is faked at the I/O boundary, as in scenario-interaction.test.ts.

import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'puppeteer';
import { executeActionOnPage } from '../../scripts/shared/interaction-executor.js';
import { executeInteractionActions } from '../../scripts/shared/puppeteer-utils.js';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';

const SELECTOR = '#bs-hiring [data-candidate-skill="drilling"]';

interface Report {
  found: boolean;
  pointerEvents?: string;
  display?: string;
  visibility?: string;
  disabled?: boolean;
  width?: number;
  height?: number;
  matchCount?: number;
}

const USABLE_REPORT: Report = {
  found: true, pointerEvents: 'auto', display: 'block', visibility: 'visible',
  disabled: false, width: 60, height: 20, matchCount: 1,
};

/**
 * Page double whose `evaluate` dispatches on the evaluated function's source:
 * the usability probe answers from `probes` (last one repeats), the
 * inspection read answers `report`.
 */
function hoverPage(opts: {
  probes?: Array<string | null>;
  report?: Report;
  hover?: (selector: string) => Promise<void>;
} = {}) {
  const probes = [...(opts.probes ?? [null])];
  const evaluate = vi.fn(async (fn: unknown) => {
    const src = String(fn);
    if (src.includes('__probeSelector')) return probes.length > 1 ? probes.shift()! : probes[0]!;
    if (src.includes('getBoundingClientRect')) return opts.report ?? USABLE_REPORT;
    return null;
  });
  const hover = vi.fn(opts.hover ?? (async () => {}));
  const click = vi.fn();
  const page = { evaluate, hover, click, waitForSelector: vi.fn() } as unknown as Page;
  return { page, evaluate, hover, click };
}

const playerStep = (action: NonNullable<ScenarioStepDef['interaction']>): ScenarioStepDef => ({
  command: 'employee list',
  description: 'hover a candidate skill chip',
  role: 'player',
  interaction: action,
});

describe('executeActionOnPage — hoverSelector (issue #2188)', () => {
  it('moves the real pointer onto the target once it is usable, and never clicks', async () => {
    const { page, hover, click } = hoverPage();
    const action = { type: 'hoverSelector' as const, selector: SELECTOR };

    await executeActionOnPage(page, action, playerStep([action]));

    expect(hover).toHaveBeenCalledTimes(1);
    expect(hover).toHaveBeenCalledWith(SELECTOR);
    expect(click).not.toHaveBeenCalled();
  });

  it('is allowed inside a player step (it is a player action, not a console command)', async () => {
    const { page, hover } = hoverPage();
    const action = { type: 'hoverSelector' as const, selector: '.bs-crew-morale-value' };

    await expect(executeActionOnPage(page, action, playerStep([action]))).resolves.toBeUndefined();
    expect(hover).toHaveBeenCalledWith('.bs-crew-morale-value');
  });

  it('waits while the target is absent, then hovers only after the probe calls it usable', async () => {
    const { page, evaluate, hover } = hoverPage({ probes: ['absent', 'hidden', null] });
    const probeCalls = () => evaluate.mock.calls.filter(([fn]) => String(fn).includes('__probeSelector')).length;
    const callsAtHover: number[] = [];
    hover.mockImplementation(async () => { callsAtHover.push(probeCalls()); });
    const action = { type: 'hoverSelector' as const, selector: SELECTOR };

    await executeActionOnPage(page, action, playerStep([action]));

    expect(hover).toHaveBeenCalledTimes(1);
    expect(callsAtHover).toEqual([3]);
  });

  it('a target that never renders throws an error naming hoverSelector, the selector and that it never appeared, without hovering', async () => {
    const { page, hover } = hoverPage({ probes: ['absent'], report: { found: false } });
    // A spent deadline: exactly one poll, then the diagnosis.
    const action = { type: 'hoverSelector' as const, selector: SELECTOR, timeout: -1 };

    let caught: unknown;
    try {
      await executeActionOnPage(page, action, playerStep([action]));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(`hoverSelector "${SELECTOR}"`);
    expect(message).toContain('element never appeared in the DOM');
    expect(hover).not.toHaveBeenCalled();
  });

  it('a disabled target throws an error naming hoverSelector, the selector and "element is disabled"', async () => {
    const { page, hover } = hoverPage({
      probes: ['disabled'],
      report: { ...USABLE_REPORT, disabled: true },
    });
    const action = { type: 'hoverSelector' as const, selector: SELECTOR, timeout: -1 };

    let caught: unknown;
    try {
      await executeActionOnPage(page, action, playerStep([action]));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(`hoverSelector "${SELECTOR}"`);
    expect((caught as Error).message).toContain('element is disabled');
    expect(hover).not.toHaveBeenCalled();
  });

  it('a target covered by another element fails naming the selector, not as a click failure', async () => {
    const { page, hover } = hoverPage({
      probes: ['covered'],
      report: { ...USABLE_REPORT, covering: 'div.bs-overlay' } as Report,
    });
    const action = { type: 'hoverSelector' as const, selector: SELECTOR, timeout: -1 };

    const caught = await executeActionOnPage(page, action, playerStep([action])).then(() => undefined, (e: unknown) => e);

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(`hoverSelector "${SELECTOR}"`);
    expect((caught as Error).message).not.toContain('clickSelector');
    expect(hover).not.toHaveBeenCalled();
  });

  it('retries a transient refusal (a node the panel just re-rendered) instead of failing the step', async () => {
    let refused = false;
    const { page, hover } = hoverPage({
      hover: async () => {
        if (!refused) { refused = true; throw new Error('Node is detached from document'); }
      },
    });
    const action = { type: 'hoverSelector' as const, selector: SELECTOR };

    await executeActionOnPage(page, action, playerStep([action]));

    expect(hover).toHaveBeenCalledTimes(2);
  });

  it('a refusal that inspects as a real block is reported by name and not retried', async () => {
    const { page, hover } = hoverPage({
      report: { ...USABLE_REPORT, disabled: true },
      hover: async () => { throw new Error('Node is either not clickable or not an Element'); },
    });
    const action = { type: 'hoverSelector' as const, selector: SELECTOR };

    const caught = await executeActionOnPage(page, action, playerStep([action])).then(() => undefined, (e: unknown) => e);

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(`hoverSelector "${SELECTOR}"`);
    expect((caught as Error).message).toContain('element is disabled');
    expect(hover).toHaveBeenCalledTimes(1);
  });
});

describe('executeInteractionActions — hoverSelector settles the UI after the pointer move (issue #2188)', () => {
  // The tooltip appears on the next frame's UI update; a screenshot taken
  // straight after the hover would miss it, so the harness settles on rAF.
  function settlePage() {
    const events: string[] = [];
    const evaluate = vi.fn(async (fn: unknown) => {
      const src = String(fn);
      if (src.includes('__probeSelector')) return null;
      if (src.includes('requestAnimationFrame')) { events.push('settle'); return undefined; }
      if (src.includes('__gameState')) return { gameState: null, uiState: null };
      return null;
    });
    const hover = vi.fn(async () => { events.push('hover'); });
    const page = { evaluate, hover, screenshot: vi.fn() } as unknown as Page;
    return { page, events };
  }

  it('runs a UI settle after the hover and before the next action', async () => {
    const { page, events } = settlePage();
    const step = playerStep([
      { type: 'hoverSelector', selector: SELECTOR },
      { type: 'screenshot' },
    ]);

    await executeInteractionActions(page, step, false, '/tmp/out', '00', 'hover');

    const hoverAt = events.indexOf('hover');
    expect(hoverAt).toBeGreaterThanOrEqual(0);
    expect(events.slice(hoverAt + 1)).toContain('settle');
  });
});
