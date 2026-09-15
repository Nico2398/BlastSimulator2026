// BlastSimulator2026 — clickWithTransientRetry: a refused click is retried
// only when the refreshed node says the refusal was a race
//
// Puppeteer's `page.click()` can refuse a control the probe just called
// usable: "Node is detached from document" when a panel rebuilt it between
// probe and click (PR #1080, shard 5), "not clickable" a beat before layout
// settles on a loaded runner (#1045). The primitive re-inspects the selector
// after each refusal and retries while the fresh node reads as attached,
// not inert, not disabled, visible and uncovered — and fails by name, once,
// on anything else. These pin that boundary and the retry budget.

import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'puppeteer';
import {
  clickWithTransientRetry, CLICK_SELECTOR_ZERO_SIZE_CLICK_RETRIES,
} from '../../scripts/shared/click-retry.js';

const CLICKABLE = {
  found: true, pointerEvents: 'auto', display: 'block', visibility: 'visible',
  disabled: false, width: 40, height: 18, matchCount: 1,
};

/** A page whose `click` is scripted and whose `inspectSelector` evaluate returns `report`. */
function fakePage(click: () => Promise<void>, report: Record<string, unknown> = CLICKABLE): Page {
  const evaluate = vi.fn(async (fn: unknown) => (String(fn).includes('getBoundingClientRect') ? report : null));
  return { evaluate, click: vi.fn(click) } as unknown as Page;
}

function refusedTimes(n: number): () => Promise<void> {
  let refusals = 0;
  return async () => {
    if (refusals < n) { refusals++; throw new Error('Node is detached from document'); }
  };
}

describe('clickWithTransientRetry', () => {
  it('clicks the replacement node when the first click lands on one the panel threw away', async () => {
    const page = fakePage(refusedTimes(1));
    await clickWithTransientRetry(page, '[data-hole="H1"] [data-action="charge-hole"]', 'left');
    expect(page.click).toHaveBeenCalledTimes(2);
    expect(page.click).toHaveBeenLastCalledWith('[data-hole="H1"] [data-action="charge-hole"]', { button: 'left' });
  });

  it('gives up after CLICK_SELECTOR_ZERO_SIZE_CLICK_RETRIES attempts and names the selector', async () => {
    const page = fakePage(refusedTimes(Infinity));
    await expect(clickWithTransientRetry(page, '#x', 'left')).rejects.toThrow(
      'clickSelector "#x" failed: element is present and looks clickable — the browser still refused it',
    );
    expect(page.click).toHaveBeenCalledTimes(CLICK_SELECTOR_ZERO_SIZE_CLICK_RETRIES);
  });

  it('does not retry a real block — a disabled control fails on the first attempt', async () => {
    const page = fakePage(refusedTimes(Infinity), { ...CLICKABLE, disabled: true });
    await expect(clickWithTransientRetry(page, '#x', 'left')).rejects.toThrow('clickSelector "#x" failed: element is disabled');
    expect(page.click).toHaveBeenCalledTimes(1);
  });

  it('does not retry a control that vanished — nothing to click again', async () => {
    const page = fakePage(refusedTimes(Infinity), { found: false });
    await expect(clickWithTransientRetry(page, '#x', 'left')).rejects.toThrow('element vanished from the DOM');
    expect(page.click).toHaveBeenCalledTimes(1);
  });

  it('prefixes the failure with the caller\'s action name, so a driver click is not reported as clickSelector', async () => {
    const page = fakePage(refusedTimes(Infinity), { ...CLICKABLE, covering: 'div.bs-modal' });
    await expect(clickWithTransientRetry(page, '#x', 'left', 'clickLabel')).rejects.toThrow(
      'clickLabel "#x" failed: element is covered by div.bs-modal',
    );
  });
});
