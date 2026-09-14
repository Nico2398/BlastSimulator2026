// BlastSimulator2026 — interaction-driver: a player click goes through the
// retrying primitive
//
// `runAction`'s `click` and `clickLabel` used to call `page.click` bare — one
// probe, one click, no retry — the exact shape that lost `clickIfPresent` a
// CI shard when a panel rebuilt the control between the two (PR #1080).
// These pin that both player actions now survive one refused click on a
// re-rendered node and still fail by name, with a diagnosis, on a real block.

import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'puppeteer';
import { runAction, InteractionFailure } from '../../scripts/shared/interaction-driver.js';

const CLICKABLE = {
  found: true, pointerEvents: 'auto', display: 'block', visibility: 'visible',
  disabled: false, width: 40, height: 18, matchCount: 1,
};
const HIRE = { selector: '#bs-crew-panel [data-action="hire"]', label: 'Hire', tag: 'button', region: 'crew', usable: true, blockedBy: null, hint: null };

/**
 * A page where the selector probe answers "usable", `inspectSelector` reads
 * back `report`, the UI-actions probe lists `actions`, and `click` is scripted.
 * Dispatch is on the evaluated function's source, as the executor tests do.
 */
function fakePage(click: () => Promise<void>, report: Record<string, unknown> = CLICKABLE, actions: unknown[] = [HIRE]): Page {
  const evaluate = vi.fn(async (fn: unknown) => {
    const src = String(fn);
    if (src.includes('__probeSelector')) return null;
    if (src.includes('getBoundingClientRect')) return report;
    if (src.includes('__uiActions')) return actions;
    return null;
  });
  return { evaluate, click: vi.fn(click) } as unknown as Page;
}

function refusedOnce(): () => Promise<void> {
  let refused = false;
  return async () => {
    if (!refused) { refused = true; throw new Error('Node is detached from document'); }
  };
}

describe('runAction — click and clickLabel retry a re-rendered control', () => {
  it('click: a node the panel replaced between probe and click is clicked again', async () => {
    const page = fakePage(refusedOnce());
    await runAction(page, { do: 'click', selector: HIRE.selector });
    expect(page.click).toHaveBeenCalledTimes(2);
    expect(page.click).toHaveBeenLastCalledWith(HIRE.selector, { button: 'left' });
  });

  it('clickLabel: resolves the label to its selector, then clicks through the same retry', async () => {
    const page = fakePage(refusedOnce());
    await runAction(page, { do: 'clickLabel', label: 'hire' });
    expect(page.click).toHaveBeenCalledTimes(2);
    expect(page.click).toHaveBeenLastCalledWith(HIRE.selector, { button: 'left' });
  });

  it('click: a real block is an InteractionFailure naming the action, the selector and the reason', async () => {
    const page = fakePage(async () => { throw new Error('Node is either not clickable or not an Element'); }, { ...CLICKABLE, disabled: true });
    const failure = await runAction(page, { do: 'click', selector: HIRE.selector }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(InteractionFailure);
    expect((failure as Error).message).toBe(`click "${HIRE.selector}" failed: element is disabled`);
    expect(page.click).toHaveBeenCalledTimes(1);
  });
});
