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
import type { PlayerAction } from '../../scripts/shared/interaction-types.js';

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

// `focusTile` (issue #1238): the evaluated function calls `__cameraFocus`
// unconditionally, and `__cameraOrbit` only when the action carries a
// `pitch` and/or `yaw`. Same pattern as the click/clickLabel tests above —
// `page.evaluate` is mocked to capture the function and args passed to it,
// then the captured function is invoked directly against a stubbed
// `window` to assert what it actually does, without a real browser.
describe('runAction — focusTile wires __cameraOrbit alongside __cameraFocus', () => {
  /**
   * Captures every `page.evaluate(fn, args)` call `runAction` makes, then
   * picks out the one `focusTile` itself issues — `runAction` always follows
   * up with `waitForUiUpdate`'s own two unrelated `evaluate` calls (a raf
   * settle, a placement-phase poll), so the last call is not necessarily the
   * one under test. Identified by source text rather than call order, since
   * `evaluate` here receives the real, unstringified function object.
   */
  function capturingPage(): { page: Page; getFocusTileEvaluated: () => { fn: (args: unknown) => void; args: unknown } } {
    const calls: { fn: (args: unknown) => void; args: unknown }[] = [];
    const evaluate = vi.fn(async (fn: unknown, args: unknown) => {
      calls.push({ fn: fn as (args: unknown) => void, args });
    });
    const page = { evaluate } as unknown as Page;
    return {
      page,
      getFocusTileEvaluated: () => {
        const match = calls.find(c => c.fn.toString().includes('__cameraFocus'));
        if (!match) throw new Error('no page.evaluate call referencing __cameraFocus was made');
        return match;
      },
    };
  }

  /** Stubs `window` for the duration of `run`, then restores it. */
  function withStubbedWindow(run: (stub: { __cameraFocus: ReturnType<typeof vi.fn>; __cameraOrbit: ReturnType<typeof vi.fn> }) => void): { cameraFocus: ReturnType<typeof vi.fn>; cameraOrbit: ReturnType<typeof vi.fn> } {
    const cameraFocus = vi.fn();
    const cameraOrbit = vi.fn();
    const renderFrame = vi.fn();
    const stub = { __cameraFocus: cameraFocus, __cameraOrbit: cameraOrbit, __renderFrame: renderFrame };
    const original = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = stub;
    try {
      run(stub);
    } finally {
      (globalThis as { window?: unknown }).window = original;
    }
    return { cameraFocus, cameraOrbit };
  }

  it('pitch set, yaw unset: calls __cameraOrbit(undefined, pitch) alongside __cameraFocus', async () => {
    const { page, getFocusTileEvaluated } = capturingPage();
    await runAction(page, { do: 'focusTile', x: 5, z: 9, pitch: 40 } as PlayerAction);
    const { fn, args } = getFocusTileEvaluated();
    const { cameraFocus, cameraOrbit } = withStubbedWindow(() => fn(args));
    expect(cameraFocus).toHaveBeenCalledWith(5, 9, 25); // default distance
    expect(cameraOrbit).toHaveBeenCalledWith(undefined, 40);
  });

  it('neither pitch nor yaw set: does not call __cameraOrbit at all, only __cameraFocus', async () => {
    const { page, getFocusTileEvaluated } = capturingPage();
    await runAction(page, { do: 'focusTile', x: 5, z: 9 } as PlayerAction);
    const { fn, args } = getFocusTileEvaluated();
    const { cameraFocus, cameraOrbit } = withStubbedWindow(() => fn(args));
    expect(cameraFocus).toHaveBeenCalledWith(5, 9, 25);
    expect(cameraOrbit).not.toHaveBeenCalled();
  });

  it('yaw alone: calls __cameraOrbit(yaw, undefined)', async () => {
    const { page, getFocusTileEvaluated } = capturingPage();
    await runAction(page, { do: 'focusTile', x: 1, z: 2, yaw: 70 } as PlayerAction);
    const { fn, args } = getFocusTileEvaluated();
    const { cameraOrbit } = withStubbedWindow(() => fn(args));
    expect(cameraOrbit).toHaveBeenCalledWith(70, undefined);
  });

  it('yaw and pitch both set: calls __cameraOrbit(yaw, pitch) and __cameraFocus with the given distance', async () => {
    const { page, getFocusTileEvaluated } = capturingPage();
    await runAction(page, { do: 'focusTile', x: 3, z: 4, distance: 12, yaw: 15, pitch: 60 } as PlayerAction);
    const { fn, args } = getFocusTileEvaluated();
    const { cameraFocus, cameraOrbit } = withStubbedWindow(() => fn(args));
    expect(cameraFocus).toHaveBeenCalledWith(3, 4, 12);
    expect(cameraOrbit).toHaveBeenCalledWith(15, 60);
  });
});
